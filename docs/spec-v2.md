# Implementation Guide: Tana Tunnel — Menu Bar App

## Overview

A Tauri v2 menu bar application that simplifies exposing a local Tana MCP server to the internet via Cloudflare Tunnels. The app provides two modes: a zero-config "quick tunnel" for ephemeral access, and a guided "persistent tunnel" setup for stable, named endpoints. The goal is to eliminate the manual `cloudflared` configuration, launchd plist authoring, and Cloudflare API wrangling that the current `cfa-tana-tunnel` workflow requires.

## Background & Context

### System Context

Tana runs a local MCP server on `localhost:8262`. To make this accessible to remote MCP consumers (Claude, other agents, mobile apps), you need a reverse tunnel from the public internet to localhost. Cloudflare Tunnels are the mechanism: `cloudflared` runs locally, establishes an outbound connection to Cloudflare's edge, and Cloudflare routes inbound requests through that connection to localhost.

The current setup (`cfa-tana-tunnel`) works but requires manual orchestration: running an Alchemy IaC script to provision the tunnel, editing a launchd plist, installing it, and managing the lifecycle by hand. This app wraps all of that into a native macOS menu bar experience.

### Technical Background

**Cloudflare Quick Tunnels**: `cloudflared tunnel --url localhost:8262` creates an ephemeral tunnel with a random `*.trycloudflare.com` URL. No Cloudflare account needed. The URL changes every time. Good for testing or one-off sharing.

**Cloudflare Named Tunnels**: Created via the Cloudflare API, these are persistent tunnel configurations associated with a Cloudflare account. They get a stable tunnel ID and can be mapped to a custom hostname via DNS CNAME. Requires an API token with tunnel and DNS permissions, and a domain added as a zone in the user's Cloudflare account. The domain can use either Cloudflare's nameservers (Full Setup — recommended, allows automatic DNS record creation) or external nameservers (Partial/CNAME Setup — the user must manually create CNAME records at their DNS provider pointing to `subdomain.domain.tld.cdn.cloudflare.net`). Full Setup is strongly preferred because the app can manage DNS records via the CF API automatically.

**`cloudflared` process**: The tunnel connector binary. It must run on the user's machine to proxy traffic. It accepts a `--token` flag for named tunnels or a `--url` flag for quick tunnels. The app's primary job is managing this process.

**Tauri v2 System Tray**: Tauri v2 supports system tray icons with context menus, click event handling, and dynamic icon/tooltip updates via the `tray-icon` feature. The app runs primarily as a tray icon with no persistent window — just a popover panel or menu for status and controls.

**Cloudflare Prepopulated Token URLs**: The Cloudflare dashboard supports an undocumented URL format that pre-fills the token creation page with specific permissions. The community tool at `cfdata.lol/tools/api-token-url-generator` documents the format. This means the app can generate a direct link that opens the CF dashboard with exactly the right permissions pre-selected — the user just reviews and clicks "Create Token."

### Why This Approach?

**User-owned infrastructure**: Rather than running a multi-tenant provisioning service, each user provisions tunnels on their own Cloudflare account. This avoids operational burden, abuse risk, and the likelihood that Tana will eventually ship hosted MCP access, making the tool unnecessary. A lightweight utility that helps users set up their own tunnel is the right level of commitment.

**Tauri over Electron**: Smaller binary, native performance, Rust backend for process management. The app's UI needs are minimal (status display, setup wizard) so Tauri's webview is more than adequate. Cross-platform potential is a bonus, though macOS is the primary target since Tana is desktop-first.

**Menu bar over full window app**: Tunnel status is classic menu-bar-app territory — it's a background service with occasional glanceable state. Similar to VPN clients, cloud sync tools, etc.

## Architecture & Design Decisions

### High-Level Architecture

```
┌─────────────────────────────────────────────────┐
│  Tauri Menu Bar App                             │
│                                                 │
│  ┌───────────┐  ┌────────────┐  ┌────────────┐ │
│  │ Tray Icon │  │ Setup      │  │ Status     │ │
│  │ + Menu    │  │ Wizard     │  │ Popover    │ │
│  │ (Rust)    │  │ (Webview)  │  │ (Webview)  │ │
│  └─────┬─────┘  └─────┬──────┘  └─────┬──────┘ │
│        │              │               │         │
│  ┌─────▼──────────────▼───────────────▼───────┐ │
│  │  Core Logic (Rust)                         │ │
│  │                                            │ │
│  │  - Process manager (spawn/kill cloudflared)│ │
│  │  - Config store (tunnel mode, credentials) │ │
│  │  - Health checker (Tana port, tunnel)      │ │
│  │  - CF API client (tunnel CRUD, DNS)        │ │
│  │  - launchd plist manager (install/remove)  │ │
│  └────────────────────┬───────────────────────┘ │
└───────────────────────┼─────────────────────────┘
                        │
           ┌────────────▼────────────┐
           │  cloudflared (child     │
           │  process or launchd)    │
           └────────────┬────────────┘
                        │
              outbound to Cloudflare edge
                        │
           ┌────────────▼────────────┐
           │  https://your.domain/mcp│
           │  (or *.trycloudflare.com│
           └─────────────────────────┘
```

### Key Design Decisions

- **Rust-side process management**: `cloudflared` is spawned and monitored from Rust, not from the JS frontend. This gives reliable process lifecycle control, signal handling, and stdout/stderr parsing. The frontend communicates with the Rust backend via Tauri commands.

- **Config stored as local JSON**: Tunnel configuration (mode, API token, account ID, hostname, tunnel ID, tunnel token) is stored in a JSON file in the platform config directory (`~/Library/Application Support/com.tana-tunnel/config.json` on macOS). No database needed — the state is small and simple.

- **Two distinct flows, one app**: Quick tunnel and persistent tunnel share the same tray UI for status/controls but have different setup paths and different runtime behavior (direct process management vs. launchd delegation). The mode is stored in config and determines which code paths run.

- **`cloudflared` not bundled in v1**: Require the user to have `cloudflared` installed (via Homebrew or direct download). The app checks for it at startup and shows a helpful prompt if it's missing. Bundling adds complexity around updates and architecture detection that isn't worth it for the initial version.

- **Prepopulated token URL for onboarding**: For the persistent tunnel setup, instead of asking the user to figure out which CF permissions to enable, the app generates a URL like `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=[{"key":"argotunnel","type":"edit"},{"key":"dns","type":"edit"},...]&name=Tana+Tunnel` that opens the CF dashboard with the exact permissions pre-selected. The user just reviews, selects their zone, and clicks create. This is significantly better UX than listing permissions in documentation.

### Alternative Approaches Considered

- **OAuth flow with Cloudflare**: CF supports OAuth for third-party apps, which would eliminate manual token creation entirely. However, it requires registering as a CF app, handling token refresh, and adds significant complexity. The prepopulated token URL gets 80% of the UX benefit with 10% of the effort. Could be a future enhancement.

- **Bundling `cloudflared`**: Shipping the binary inside the app would remove an install step, but `cloudflared` updates frequently and the app would need to handle architecture detection (arm64 vs x86_64), binary updates, and code signing implications. Not worth it for v1.

- **Swift-native instead of Tauri**: A pure Swift menu bar app would be more native on macOS but loses cross-platform potential and requires more boilerplate for the webview-based setup wizard. Given the vibecodable nature of the project, Tauri's web frontend is easier to iterate on.

## Implementation Milestones

### Milestone 1: Tauri v2 Menu Bar Shell

**Goal**: Get a minimal Tauri v2 app running as a menu bar icon with a context menu, no persistent dock icon, and a basic popover window.

**Changes Required**:

- Initialize a new Tauri v2 project
- Configure system tray with icon and context menu
- Set macOS activation policy to `Accessory` (no dock icon)
- Create a minimal webview panel that appears on tray icon click

**Implementation Details**:

Initialize the project with `bun create tauri-app tana-tunnel` (or `npm create tauri-app`), selecting TypeScript + your preferred frontend framework (vanilla or React — keep it simple, React is fine for the wizard flow).

In `src-tauri/Cargo.toml`, enable the tray feature:

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
```

In `src-tauri/tauri.conf.json`, remove the default window from the `windows` array — the app shouldn't open a main window on launch. Configure the tray:

```json
{
   "app": {
      "trayIcon": {
         "iconPath": "icons/tray-icon.png",
         "iconAsTemplate": true
      },
      "windows": []
   }
}
```

In `src-tauri/src/lib.rs` (or `main.rs`), set up the tray with a context menu:

```rust
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Manager,
};

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Build context menu
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;

            // Create tray icon
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { .. } = event {
                        // Toggle popover window here
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

On macOS, hide the dock icon by setting the activation policy. In Tauri v2, this is typically done in the `setup` hook or via the `Info.plist` by setting `LSUIElement` to `true` in the `tauri.conf.json` bundle config:

```json
{
   "bundle": {
      "macOS": {
         "infoPlist": {
            "LSUIElement": true
         }
      }
   }
}
```

Create a small tray icon (16x16 or 22x22 PNG, monochrome for macOS template rendering). A simple tunnel/bridge icon works well.

**Verification**:

- `bun tauri dev` launches the app
- A tray icon appears in the macOS menu bar
- No dock icon appears
- Right-clicking the tray icon shows the context menu with "Quit"
- Clicking "Quit" exits the app

**Potential Issues**:

- Tauri v2 tray API has changed from v1 — make sure you're referencing the v2 docs at `v2.tauri.app`, not the v1 docs. The `SystemTray` API from v1 is replaced with `TrayIconBuilder`.
- `iconAsTemplate: true` is important on macOS for the icon to adapt to light/dark mode correctly.

---

### Milestone 2: Quick Tunnel Mode

**Goal**: Implement the quick tunnel flow — detect Tana, spawn `cloudflared`, parse the generated URL, display it in the tray menu.

**Changes Required**:

- Add `cloudflared` detection (check if binary exists in PATH or common locations)
- Add Tana detection (check if `localhost:8262` is accepting connections)
- Implement `cloudflared tunnel --url` process spawning and stdout parsing
- Update tray menu dynamically to show tunnel URL and status
- Add copy-URL-to-clipboard action

**Implementation Details**:

Create a Rust module `src-tauri/src/tunnel.rs` for process management. The core logic:

```rust
use std::process::{Command, Child, Stdio};
use std::io::{BufRead, BufReader};

pub struct QuickTunnel {
    process: Option<Child>,
    pub url: Option<String>,
}

impl QuickTunnel {
    pub fn start() -> Result<Self, String> {
        let mut child = Command::new("cloudflared")
            .args(["tunnel", "--url", "http://localhost:8262"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start cloudflared: {}", e))?;

        // cloudflared prints the URL to stderr
        // Parse it from the output
        // The URL line looks like: "... https://xxx-yyy-zzz.trycloudflare.com ..."

        // Return the tunnel handle — URL parsing happens async
        Ok(Self { process: Some(child), url: None })
    }

    pub fn stop(&mut self) {
        if let Some(ref mut child) = self.process {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.process = None;
        self.url = None;
    }
}
```

Note that `cloudflared` outputs the tunnel URL to stderr, not stdout. The line containing the URL typically includes `trycloudflare.com`. You'll want to spawn a thread to read stderr line by line and extract the URL using a regex or string match, then notify the frontend via a Tauri event.

For Tana detection, a simple TCP connect check:

```rust
use std::net::TcpStream;
use std::time::Duration;

pub fn is_tana_running() -> bool {
    TcpStream::connect_timeout(
        &"127.0.0.1:8262".parse().unwrap(),
        Duration::from_millis(500),
    ).is_ok()
}
```

For `cloudflared` detection:

```rust
pub fn find_cloudflared() -> Option<String> {
    // Check PATH first
    if Command::new("cloudflared").arg("--version").output().is_ok() {
        return Some("cloudflared".to_string());
    }
    // Check common Homebrew locations
    for path in &["/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared"] {
        if std::path::Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    None
}
```

Expose these as Tauri commands:

```rust
#[tauri::command]
fn start_quick_tunnel(state: State<AppState>) -> Result<(), String> { ... }

#[tauri::command]
fn stop_tunnel(state: State<AppState>) -> Result<(), String> { ... }

#[tauri::command]
fn get_tunnel_status(state: State<AppState>) -> TunnelStatus { ... }
```

On the frontend, the tray menu should update dynamically based on state. When a tunnel is running, show the URL (clickable to copy) and a "Stop Tunnel" option. When idle, show "Start Quick Tunnel" and "Set Up Persistent Tunnel..."

**Verification**:

- With Tana running on 8262, clicking "Start Quick Tunnel" spawns `cloudflared` and a URL appears in the menu within ~5 seconds
- The URL is copyable to clipboard
- Visiting the URL in a browser reaches Tana's MCP endpoint (you'll get a response or at least a connection)
- Clicking "Stop Tunnel" kills the process and resets the menu
- If Tana isn't running, the app shows a warning instead of starting the tunnel
- If `cloudflared` isn't installed, the app shows an install prompt

**Potential Issues**:

- `cloudflared` URL output timing: The URL doesn't appear immediately. The app needs to handle the "starting..." state gracefully.
- The stderr parsing needs to handle `cloudflared`'s log format, which may vary between versions. Be flexible with the regex.
- Process cleanup on app quit: Make sure `cloudflared` is killed when the app exits. Implement `Drop` for the tunnel struct or handle the quit event.

---

### Milestone 3: Persistent Tunnel Setup Wizard

**Goal**: Build a webview-based setup wizard that guides the user through creating a Cloudflare API token, entering their credentials, and provisioning a named tunnel with a custom hostname.

**Changes Required**:

- Create a multi-step wizard UI (webview)
- Generate the prepopulated Cloudflare token creation URL
- Implement CF API client in Rust (create tunnel, configure ingress, create DNS CNAME)
- Store configuration to disk
- Show the wizard from the tray menu

**Implementation Details**:

**The Prepopulated Token URL**:

The Cloudflare dashboard supports a URL format to pre-fill the token creation page. The permissions needed for tunnel management are:

- `argotunnel` (Cloudflare Tunnel) — Edit
- `dns` (DNS) — Edit
- `workers_scripts` (Workers Scripts) — Edit (if using Alchemy for state, optional)
- `workers_kv_storage` (Workers KV Storage) — Edit (if using Alchemy for state, optional)

At minimum, only `argotunnel:edit` and `dns:edit` are required. The URL format is:

```
https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=[{"key":"argotunnel","type":"edit"},{"key":"dns","type":"edit"}]&name=Tana+Tunnel
```

URL-encode the JSON array. The app should generate this URL and open it in the user's default browser. The wizard step says something like: "Click the button below to open Cloudflare and create an API token with the right permissions. Once created, paste the token back here."

**Wizard Steps**:

1. **Welcome / Prerequisites**: Check for `cloudflared`. Explain what the setup will do. State clearly that the user needs: (a) a Cloudflare account, (b) a domain added as a zone in that account. Link to CF's "Add a site" docs for users who haven't done this yet. Recommend Full Setup (Cloudflare nameservers) for the smoothest experience.
2. **Cloudflare Token**: Open prepopulated token URL in browser. Text field to paste the token back. Verify the token works by calling `GET /user/tokens/verify`.
3. **Account & Zone Selection**: Use the token to call `GET /accounts` and `GET /zones` — present dropdowns so the user picks their account and zone (domain). Store the account ID and zone ID. If no zones are returned, show a helpful message explaining they need to add a domain to Cloudflare first, with a link to the CF dashboard. Also detect whether the zone uses CF nameservers (Full Setup) or external nameservers (Partial Setup) via the zone's `status` field in the API response.
4. **Hostname**: Let the user pick a subdomain. Show it as `{input}.{selected-zone}`. Validate it's not already taken (DNS lookup or CF API check).
5. **Provision**: Create the tunnel via CF API, configure ingress. For Full Setup zones, create the DNS CNAME record automatically via CF API. For Partial Setup zones, show the user the CNAME record they need to create at their external DNS provider (`{subdomain}.{domain}` → `{tunnel_id}.cfargotunnel.com`) and provide a "I've done this" confirmation button before proceeding. Show progress. Store the tunnel token in config.
6. **Done**: Show the final URL. For Partial Setup zones, remind the user that DNS propagation may take longer since their external provider controls it. Offer to start the tunnel now or set up auto-start.

**CF API Client** (Rust side):

The key API calls, all authenticated with `Authorization: Bearer <token>`:

```
# Create tunnel
POST https://api.cloudflare.com/client/v4/accounts/{account_id}/cfd_tunnel
Body: { "name": "tana-tunnel", "tunnel_secret": "<base64 random 32 bytes>" }

# Configure tunnel ingress
PUT https://api.cloudflare.com/client/v4/accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations
Body: {
  "config": {
    "ingress": [
      {
        "hostname": "tana.example.com",
        "service": "http://localhost:8262",
        "originRequest": { "httpHostHeader": "localhost:8262" }
      },
      { "service": "http_status:404" }
    ]
  }
}

# Create DNS CNAME
POST https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records
Body: {
  "type": "CNAME",
  "name": "tana.example.com",
  "content": "{tunnel_id}.cfargotunnel.com",
  "proxied": true
}

# Get tunnel token (for cloudflared to use)
GET https://api.cloudflare.com/client/v4/accounts/{account_id}/cfd_tunnel/{tunnel_id}/token
```

Use `reqwest` on the Rust side for HTTP calls.

**Config Storage**:

```rust
#[derive(Serialize, Deserialize)]
struct AppConfig {
    mode: TunnelMode, // Quick or Persistent
    cloudflared_path: Option<String>,
    persistent: Option<PersistentConfig>,
}

#[derive(Serialize, Deserialize)]
struct PersistentConfig {
    api_token: String,
    account_id: String,
    zone_id: String,
    zone_name: String,
    dns_setup: DnsSetup, // Full or Partial
    tunnel_id: String,
    tunnel_token: String,
    hostname: String,
}

#[derive(Serialize, Deserialize)]
enum DnsSetup {
    Full,    // CF nameservers — app manages DNS records
    Partial, // External nameservers — user manages DNS records
}
```

Store at the platform config dir. On macOS: `~/Library/Application Support/com.tana-tunnel/config.json`. Use Tauri's `app.path().app_config_dir()` to get this path. Encrypt or at least restrict file permissions on the config since it contains the API token.

**Verification**:

- "Set Up Persistent Tunnel..." in the tray menu opens the wizard window
- The "Create Token" button opens the correct CF dashboard URL with permissions pre-selected
- After pasting a valid token, the wizard fetches and displays the user's accounts and zones
- Entering a hostname and clicking "Create" provisions the tunnel and DNS record
- The config file is written with all necessary data
- The wizard shows the final URL and a "Start Tunnel" button

**Potential Issues**:

- Token permissions: If the user modifies the prepopulated permissions before creating, API calls will fail. The verify step should check for specific permissions if possible, or at least give clear error messages.
- DNS propagation: The CNAME may take a few minutes to propagate. For Partial Setup zones (external DNS), propagation depends entirely on the user's DNS provider and may take longer — the app can't verify it programmatically.
- The `httpHostHeader` setting in the ingress config is critical — without it, Tana rejects requests because the Host header doesn't match `localhost:8262`. Make sure this is always included.
- Zone selection UX: Users with many zones need a way to search/filter.
- No zones available: A common failure mode will be users who have a CF account but haven't added a domain. The wizard needs a clear escape hatch here — either guide them through adding a domain or suggest quick tunnel mode instead.
- Partial Setup zones: The app can create the tunnel and ingress config, but can't create the DNS record on the user's behalf. The manual CNAME step is a UX cliff — make the instructions as copy-pastable as possible (show the exact record type, name, and value).

---

### Milestone 4: Persistent Tunnel Runtime

**Goal**: Run the persistent tunnel via `cloudflared tunnel run --token <token>`, with options for foreground (app-managed) or background (launchd) operation.

**Changes Required**:

- Implement named tunnel process management (similar to quick tunnel but with `--token`)
- Implement launchd plist generation and installation
- Add auto-start toggle in settings
- Implement tunnel health checking

**Implementation Details**:

**Foreground mode** (app-managed): Same as quick tunnel process management, but using:

```
cloudflared tunnel run --token <tunnel_token>
```

**Background mode** (launchd): Generate and install a plist. Template:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.tana-tunnel.cloudflared</string>
    <key>ProgramArguments</key>
    <array>
        <string>{cloudflared_path}</string>
        <string>tunnel</string>
        <string>run</string>
        <string>--token</string>
        <string>{tunnel_token}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>{log_dir}/tana-tunnel.log</string>
    <key>StandardErrorPath</key>
    <string>{log_dir}/tana-tunnel.err</string>
</dict>
</plist>
```

Install to `~/Library/LaunchAgents/com.tana-tunnel.cloudflared.plist`, then load with `launchctl load <path>`. Unload with `launchctl unload <path>`.

**Health checking**: Periodically (every 30s) check:

1. Is the `cloudflared` process running? (Check PID or `launchctl list | grep tana-tunnel`)
2. Is Tana running on 8262? (TCP connect check)
3. Is the tunnel endpoint responding? (HTTP GET to the public URL)

Update the tray icon color/state based on health:

- Green: Everything healthy
- Yellow: Tunnel running but Tana not detected on 8262
- Red: Tunnel process not running
- Gray: Not configured

**Verification**:

- Starting persistent tunnel in foreground mode connects successfully
- Enabling "Run at startup" installs the launchd plist and loads it
- After a reboot (or `launchctl load`), the tunnel starts automatically
- Tray icon reflects actual tunnel health
- Disabling auto-start unloads and removes the plist
- Logs are accessible from the tray menu ("View Logs...")

**Potential Issues**:

- launchd plist installation requires the correct path and permissions. The plist must be owned by the current user.
- If `cloudflared` is installed via Homebrew and gets updated, the binary path doesn't change, but behavior might. The app should show the `cloudflared` version somewhere.
- The tunnel token is stored in the plist in plaintext. This is the same as the current manual setup, but worth noting in docs.

---

### Milestone 5: Polish & Settings

**Goal**: Add settings management, error states, first-run experience, and quality-of-life features.

**Changes Required**:

- Settings panel (change mode, reconfigure, reset)
- Proper error handling and user-facing error messages
- "What's this?" / onboarding for first launch
- Copy URL action, open in browser action
- About panel with version info
- Uninstall/cleanup option (remove tunnel, DNS record, launchd plist)

**Implementation Details**:

**Settings accessible from tray menu**: A "Settings..." menu item opens a settings webview window. Settings include:

- Current mode (quick/persistent) with option to switch
- Persistent tunnel details (hostname, account, tunnel ID) — read-only display
- Auto-start toggle
- Cloudflared path override
- "Reset Configuration" button (tears down tunnel, removes DNS, deletes config)
- "Reconfigure Tunnel" (re-run the wizard, keeping the same account)

**Teardown/cleanup**: When the user resets or uninstalls, the app should:

1. Stop the running tunnel
2. Unload and remove the launchd plist
3. For Full Setup zones: delete the DNS CNAME record via CF API
4. For Partial Setup zones: remind the user to delete the CNAME at their DNS provider
5. Delete the tunnel via CF API
6. Delete the local config file

This is important for a good experience — users shouldn't have orphaned tunnels and DNS records.

**Error states to handle gracefully**:

- `cloudflared` not found → prompt to install via Homebrew with copy-pastable command
- Tana not running → show in status, allow tunnel start anyway (it'll just 502 until Tana starts)
- API token expired or revoked → detect on health check, prompt to re-authenticate
- DNS hostname already exists → offer to overwrite or choose a different subdomain
- Tunnel creation fails → show the CF API error message, suggest checking permissions

**Verification**:

- All error states show clear, actionable messages (not raw error strings)
- Reset cleans up all remote resources (tunnel, DNS) and local config
- Settings changes take effect immediately
- The app feels complete for a v1 — no dead-end states

**Potential Issues**:

- Cleanup failures: If the API token has been revoked, the app can't clean up remote resources. Handle this gracefully — delete local config anyway and note that the user may need to manually clean up in the CF dashboard.
- Mode switching: Going from persistent to quick should warn that the persistent tunnel won't be torn down automatically (give the option to tear it down first).

## Testing Strategy

### Manual Testing

- Test quick tunnel end-to-end: start → copy URL → access from browser → stop
- Test persistent setup wizard: create token → complete wizard → verify tunnel works → access from browser
- Test launchd persistence: enable auto-start → reboot → verify tunnel reconnects
- Test cleanup: reset config → verify tunnel and DNS deleted in CF dashboard
- Test error paths: no `cloudflared`, no Tana running, invalid token, network issues
- Test on both Apple Silicon and Intel Macs

### Integration Tests

- CF API client: mock responses and verify tunnel/DNS creation logic
- Process management: verify `cloudflared` spawn, stdout/stderr parsing, cleanup on kill
- Config persistence: write and read config, verify schema migration between versions

## Deployment Considerations

### Prerequisites

- Tauri v2 CLI and Rust toolchain for building
- Apple Developer certificate for code signing (recommended for distribution, not required for personal use)
- A built `cloudflared` binary or Homebrew as a user prerequisite

### Distribution

- For initial testing: `bun tauri build` produces a `.dmg` or `.app` bundle
- For broader distribution: GitHub Releases with the built `.dmg`
- Consider Homebrew cask formula for discoverability among the target audience

### Rollout Strategy

- v0.1: Personal use, validate the UX end-to-end
- v0.2: Share with a few Tana community members for feedback
- v1.0: Public release once the core flows are solid

## Edge Cases & Error Handling

- **Multiple instances**: Prevent multiple copies of the app from running simultaneously (Tauri has single-instance plugin support).
- **Port conflict**: If something else is on 8262, Tana detection gives a false positive. Could add an HTTP check to the Tana MCP endpoint to confirm it's actually Tana.
- **Token rotation**: If the user creates a new CF API token, they need a way to update it without re-running the entire wizard. The settings panel should support this.
- **Tunnel name conflict**: If a tunnel named "tana-tunnel" already exists in the user's CF account, the creation will fail. Use a unique name (e.g., include hostname or random suffix).
- **cloudflared updates**: If Homebrew updates `cloudflared` while the tunnel is running, the running process isn't affected, but the launchd plist will use the new binary on next restart.
- **Partial Setup DNS cleanup**: When the user resets/tears down a persistent tunnel on a Partial Setup zone, the app can delete the tunnel and ingress config via the CF API but cannot delete the CNAME record at the user's external DNS provider. The teardown flow should remind the user to remove the CNAME manually.
- **No domain on Cloudflare**: Users who only have a CF account but no zone cannot use persistent tunnels. The wizard should detect this early (empty zone list) and redirect to quick tunnel mode or link to CF's "Add a site" flow.

## Security Considerations

- **API token storage**: The CF API token is stored in the config file. Set restrictive file permissions (600). Consider using macOS Keychain via Tauri's security plugins for a more secure approach in a future version.
- **Tunnel token in launchd plist**: Visible in plaintext to anyone who can read the user's LaunchAgents directory. This is consistent with the current manual approach but worth documenting.
- **Exposed Tana endpoint**: The tunnel exposes Tana's MCP server to the public internet. The app should prominently warn users about this and recommend adding authentication (Cloudflare Access, or application-level auth). A future milestone could add CF Access policy setup to the wizard.

## Performance Considerations

Minimal. The app is essentially a process manager with a tiny UI. Resource usage should be negligible — the tray icon, a 30-second health check timer, and occasional webview windows. `cloudflared` itself is the main resource consumer, and that's out of the app's control.

## Future Enhancements

- **Cloudflare Access integration**: Add a wizard step to configure a CF Access policy on the tunnel endpoint, so only authorized users can reach the Tana MCP server.
- **OAuth flow**: Replace the manual token creation with CF OAuth for a smoother onboarding experience.
- **Bundle `cloudflared`**: Ship the binary inside the app to eliminate the install prerequisite.
- **Windows/Linux support**: Tauri is cross-platform. Windows would use a Windows Service instead of launchd; Linux would use systemd.
- **Multi-tunnel support**: Allow multiple tunnels to different local services (not just Tana on 8262).
- **Tunnel metrics**: Show basic traffic stats from the CF API in the status panel.
- **Auto-update**: Use Tauri's built-in updater for app updates.

## Additional Resources

- [Tauri v2 System Tray docs](https://v2.tauri.app/learn/system-tray/)
- [Tauri v2 Tray API reference](https://v2.tauri.app/reference/javascript/api/namespacetray/)
- [Cloudflare Tunnel API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/)
- [Cloudflare Create Tokens via API](https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/)
- [CF Datamining Token URL Generator](https://cfdata.lol/tools/api-token-url-generator/) — documents the undocumented prepopulated token URL format
- [Tauri Menu Bar App example](https://github.com/4gray/tauri-menubar-app) — Tauri v1 but useful reference for the pattern
- [`cloudflared` source](https://github.com/cloudflare/cloudflared)
- [Your existing `cfa-tana-tunnel` repo](reference for Alchemy-based provisioning logic)

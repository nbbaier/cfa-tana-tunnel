# Tana Local MCP → Remote Bridge: Reference Guide

## Overview

Tana's local alpha API runs an MCP server on the user's machine at `http://localhost:8262/mcp` using **Streamable HTTP** transport. This document covers how to expose it to remote services (like Thoughtful, or any MCP-compatible AI tool) using a Cloudflare Tunnel.

## Tana Local API Details

- **Transport:** Streamable HTTP (not SSE, not stdio)
- **URL:** `http://localhost:8262/mcp`
- **Auth:** Bearer token (Personal Access Token) via `Authorization: Bearer <PAT>` header
- **Required headers for MCP requests:**
   - `Content-Type: application/json`
   - `Accept: application/json, text/event-stream` (Tana rejects requests without both accept types)
- **Host header validation:** Tana validates the `Host` header and rejects requests where it doesn't match `localhost:8262`

## Bridge Architecture

```
┌──────────────┐       ┌──────────────────┐       ┌─────────────────┐
│ Remote MCP   │ HTTPS │  Cloudflare Edge │ HTTP  │  Tana Local API │
│ Client       │──────→│  (tunnel proxy)  │──────→│  localhost:8262 │
│ (Thoughtful) │       │  rewrites Host   │       │  /mcp           │
└──────────────┘       └──────────────────┘       └─────────────────┘
```

The tunnel creates an outbound-only connection from the local machine to Cloudflare's edge. No inbound ports need to be opened.

## Quick Setup (Ephemeral Tunnel)

### 1. Start the tunnel

```bash
cloudflared tunnel --url http://localhost:8262 --http-host-header localhost:8262
```

The `--http-host-header` flag is **critical** — without it, Tana receives the tunnel's hostname as the Host header and rejects the request with `{"error":"forbidden","message":"Invalid Host header"}`.

This gives you a temporary URL like `https://<random-words>.trycloudflare.com`.

### 2. DNS propagation

The tunnel URL may take 1-2 minutes to resolve. If you get `Could not resolve host`, either wait or flush DNS:

```bash
sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder
```

### 3. Verify the connection

```bash
curl -X POST \
  -H "Authorization: Bearer $TANA_PAT" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  https://<tunnel-url>.trycloudflare.com/mcp \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}},"id":1}'
```

Expected response:

```json
{
   "result": {
      "protocolVersion": "2024-11-05",
      "capabilities": { "tools": { "listChanged": true } },
      "serverInfo": { "name": "tana-local", "version": "0.1.0" }
   },
   "jsonrpc": "2.0",
   "id": 1
}
```

### 4. Connect a remote MCP client

For services like Thoughtful that support remote MCP servers:

- **Server URL:** `https://<tunnel-url>.trycloudflare.com/mcp`
- **Transport Type:** HTTP (Streamable HTTP)
- **Authentication:** Bearer Token → your Tana PAT

## Gotchas & Troubleshooting

| Problem                                                                                                      | Cause                                                                                              | Fix                                                                                         |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `{"error":"forbidden","message":"Invalid Host header"}`                                                      | Tana validates Host header                                                                         | Use `--http-host-header localhost:8262` on cloudflared                                      |
| `403 Forbidden` from Cloudflare                                                                              | Sent a custom `Host` header in the curl request                                                    | Don't override Host on the client side — let cloudflared handle it via `--http-host-header` |
| `Could not resolve host`                                                                                     | DNS not propagated yet                                                                             | Wait 1-2 min or flush DNS cache                                                             |
| `{"error":"method_not_allowed","message":"SSE streams not supported"}`                                       | Sent a GET request to `/mcp`                                                                       | Use POST with a JSON-RPC body                                                               |
| `{"code":-32000,"message":"Not Acceptable: Client must accept both application/json and text/event-stream"}` | Missing Accept header                                                                              | Include `Accept: application/json, text/event-stream`                                       |
| `{"code":-32001,"message":"Authentication required..."}`                                                     | No Bearer token                                                                                    | Add `Authorization: Bearer <PAT>` header                                                    |
| ENOENT error with `mcp-proxy`                                                                                | mcp-proxy (TypeScript/punkpeye) only wraps stdio commands — it tries to spawn the URL as a process | Don't use mcp-proxy for this. Use a plain tunnel instead.                                   |

## Tool Landscape for Exposing Local MCP Servers

| Tool                               | What it does                              | Good for                                                      |
| ---------------------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| **cloudflared tunnel**             | Exposes localhost via Cloudflare edge     | Quick tunneling, already-HTTP servers like Tana               |
| **ngrok**                          | Same concept, different provider          | Alternative to cloudflared with built-in auth/policy features |
| **mcp-proxy (TS, punkpeye)**       | Wraps stdio MCP servers as HTTP+SSE       | When you need to convert stdio → HTTP (not needed for Tana)   |
| **mcp-proxy (Python, sparfenyuk)** | Bridges between HTTP and stdio transports | Transport conversion in Python environments                   |
| **Pomerium**                       | Zero-trust reverse proxy with SSH tunnels | MCP servers needing OAuth/identity-aware proxying             |
| **FastMCP .as_proxy()**            | Python proxy bridging transports          | Programmatic proxy setup in Python                            |

## Limitations of the Quick Tunnel Approach

- **Ephemeral URL:** Changes every time cloudflared restarts. Use a named tunnel with a fixed subdomain for persistence.
- **Laptop must be awake:** If the machine sleeps or cloudflared crashes, the tunnel drops. Run as a launchd service for reliability.
- **No edge auth layer:** The only protection is Tana's PAT. For production use, add Cloudflare Access policies.
- **Single user:** This approach is for personal use. A multi-user product would need a relay architecture (e.g., Durable Objects + Tauri client).

## Next Steps for Productionizing

1. **Named tunnel** with stable subdomain on a domain you control
2. **Cloudflare Access** policies for additional auth layer
3. **launchd service** to keep cloudflared running across reboots
4. **Worker middleware** for request shaping, rate limiting, observability
5. **Distributable client** (Tauri + DO relay) for making this accessible to non-technical users

## Claude Desktop Setup (for reference)

Claude Desktop uses stdio, so it needs mcp-proxy to convert Tana's HTTP to stdio:

```json
{
   "mcpServers": {
      "tana": {
         "command": "npx",
         "args": ["mcp-proxy", "http://localhost:8262/mcp"]
      }
   }
}
```

This is a separate concern from the remote bridge — Claude Desktop talks to Tana locally, the tunnel exposes Tana to remote services.

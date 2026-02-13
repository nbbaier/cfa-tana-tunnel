# cfa-tana-tunnel

Persistent Cloudflare Tunnel exposing Tana's local MCP server (`localhost:8262`) to the internet at `tana.nicobaier.com`.

## Prerequisites

- [Bun](https://bun.sh)
- [Alchemy](https://alchemy.run) (`bun add -d alchemy`)
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
- Tana desktop app running (provides the local MCP server on port 8262)

## Setup

1. Install dependencies:

   ```bash
   bun install
   ```

2. Configure your `.env`:

   ```
   ALCHEMY_PASSWORD=<your-alchemy-password>
   CLOUDFLARE_API_TOKEN=<token-with-tunnel-and-dns-permissions>
   CLOUDFLARE_ACCOUNT_ID=<your-account-id>
   ```

   The API token needs these permissions:
   - Account / Cloudflare Tunnel -- Edit
   - Account / Workers Scripts -- Edit
   - Account / Workers KV Storage -- Edit
   - Zone / DNS -- Edit

3. Deploy the tunnel:

   ```bash
   bun run deploy
   ```

   This creates a named Cloudflare Tunnel, configures ingress routing, and sets up a DNS CNAME record for `tana.nicobaier.com`.

4. Run cloudflared locally using the token from the deploy output:
   ```bash
   cloudflared tunnel run --token <token>
   ```

## Persistent Operation (macOS)

To keep the tunnel running across reboots:

1. Copy the launchd plist template:

   ```bash
   cp com.tana-mcp.tunnel.plist ~/Library/LaunchAgents/
   ```

2. Edit `~/Library/LaunchAgents/com.tana-mcp.tunnel.plist` and replace `REPLACE_WITH_TUNNEL_TOKEN` with the token from deploy output.

3. Load the service:

   ```bash
   launchctl load ~/Library/LaunchAgents/com.tana-mcp.tunnel.plist
   ```

4. Check status:
   ```bash
   launchctl list | grep tana-mcp
   ```

Logs are written to `/tmp/tana-mcp-tunnel.log` and `/tmp/tana-mcp-tunnel.err`.

## How It Works

The tunnel routes requests to `tana.nicobaier.com` to `localhost:8262` where Tana's local MCP server runs. The `originRequest.httpHostHeader` setting rewrites the Host header to `localhost:8262`, which Tana requires for authentication.

Endpoints available through the tunnel:

- `https://tana.nicobaier.com/mcp` -- MCP protocol endpoint
- `https://tana.nicobaier.com/api` -- Tana API endpoint

## Commands

- `bun run deploy` -- Deploy/update the tunnel configuration
- `bun run destroy` -- Tear down the tunnel and DNS records
- `./run-tunnel.sh` -- Deploy and run cloudflared in one step

## References

- [Alchemy Tunnel docs](https://alchemy.run/providers/cloudflare/tunnel)
- [Cloudflare Tunnel docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
- [Tana Local API](https://tana.inc)

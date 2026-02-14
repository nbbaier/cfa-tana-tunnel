# MCP OAuth Proxy for Tana Tunnel - Implementation Plan

## Context

Claude.ai requires OAuth 2.1 for remote MCP servers but Tana's local MCP server only supports bearer auth. The proxy Worker implements the MCP OAuth spec, letting Claude.ai authenticate via OAuth then forwarding requests to Tana with the real bearer token.

## Architecture

```
Claude.ai  ──(OAuth 2.1 + Bearer JWT)──>  Worker @ tana.nicobaier.com
                                              │
                                     (Bearer TANA_TOKEN)
                                              │
                                              v
                              Tunnel @ tana-origin.nicobaier.com  ──>  localhost:8262
```

**Two-hostname approach**: Move the tunnel to `tana-origin.nicobaier.com`, deploy a Worker at `tana.nicobaier.com`.

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/types.ts` | Create | Shared types |
| `src/oauth/jwt.ts` | Create | JWT create/verify helpers (Web Crypto) |
| `src/oauth/metadata.ts` | Create | `/.well-known/*` endpoints |
| `src/oauth/register.ts` | Create | Dynamic client registration |
| `src/consent.ts` | Create | HTML consent page template |
| `src/oauth/authorize.ts` | Create | Consent page + auth code |
| `src/oauth/token.ts` | Create | Code-to-JWT exchange, PKCE verify |
| `src/oauth/verify.ts` | Create | JWT verification middleware |
| `src/proxy.ts` | Create | Proxy requests to origin |
| `src/worker.ts` | Create | Hono app - main entrypoint |
| `alchemy.run.ts` | Modify | Add Worker + KV, change tunnel hostname |
| `.env.example` | Modify | Add TANA_BEARER_TOKEN, AUTH_PASSWORD, JWT_SECRET |

## OAuth Flow (what Claude.ai does)

1. Claude.ai hits `/mcp` -> gets 401 with `WWW-Authenticate: Bearer resource_metadata="..."`
2. Fetches `/.well-known/oauth-protected-resource` -> discovers auth server is self
3. Fetches `/.well-known/oauth-authorization-server` -> discovers endpoints
4. POSTs `/oauth/register` with its client metadata URL as `client_id`
5. Redirects user to `/oauth/authorize` with PKCE challenge
6. User sees consent page, enters password, submits
7. Worker generates auth code (stored in KV, 5 min TTL), redirects back to Claude.ai
8. Claude.ai POSTs `/oauth/token` with code + code_verifier
9. Worker verifies PKCE (S256), returns a signed JWT (7-day expiry)
10. Claude.ai uses JWT as Bearer token for MCP requests
11. Worker validates JWT, swaps it for Tana's bearer token, proxies to origin

## Key Implementation Details

### JWT Signing
- HMAC-SHA256 via Web Crypto API
- 7-day expiry
- Claims: `sub` (client_id), `iss` (PUBLIC_URL), `iat`, `exp`

### PKCE
- S256 mandatory
- Verify: `BASE64URL(SHA256(code_verifier)) == code_challenge`

### Client Registration
- Store in KV with prefix `client:`
- Validate redirect_uris by fetching client_id metadata URL

### Auth Codes
- Random 32-byte hex
- Stored in KV with prefix `authcode:` and 300s TTL
- Contains: client_id, redirect_uri, code_challenge, code_challenge_method

### Consent Page
- Simple HTML form with password input
- Passes through all OAuth params as hidden fields
- Styled inline (no external deps)

### Proxy
- Replace Authorization header with `Bearer ${TANA_BEARER_TOKEN}`
- Forward request to `ORIGIN_URL` preserving path, method, headers, body

## Worker Bindings

| Binding | Type | Value |
|---------|------|-------|
| `OAUTH_KV` | KV Namespace | Auth codes + client registrations |
| `TANA_BEARER_TOKEN` | Secret | Existing Tana bearer token |
| `AUTH_PASSWORD` | Secret | Password for the consent page |
| `JWT_SECRET` | Secret | HMAC key for signing JWTs |
| `ORIGIN_URL` | String | `https://tana-origin.nicobaier.com` |
| `PUBLIC_URL` | String | `https://tana.nicobaier.com` |

## Implementation Order

### Phase 1: Types & Utilities
1. **`src/types.ts`** - Hono env bindings type, OAuth types (client registration, auth code data, token request/response)
2. **`src/oauth/jwt.ts`** - `createJWT(payload, secret)` and `verifyJWT(token, secret)` using Web Crypto HMAC-SHA256

### Phase 2: OAuth Endpoints
3. **`src/oauth/metadata.ts`** - Two Hono routes:
   - `GET /.well-known/oauth-protected-resource` → `{ resource, authorization_servers }`
   - `GET /.well-known/oauth-authorization-server` → full server metadata (issuer, endpoints, supported grants/methods)
4. **`src/oauth/register.ts`** - `POST /oauth/register`:
   - Accept `client_name`, `redirect_uris`, `grant_types`, `response_types`, `token_endpoint_auth_method`, `client_uri`
   - Use `client_uri` (or generate UUID) as `client_id`
   - Store in KV under `client:{client_id}`
   - Return registration response with `client_id`
5. **`src/consent.ts`** - HTML template function that renders a password form with hidden OAuth params
6. **`src/oauth/authorize.ts`** - `GET /oauth/authorize`:
   - If no password submitted: render consent page
   - If password submitted (POST): validate password, generate auth code, store in KV with 5min TTL, redirect to `redirect_uri` with code
7. **`src/oauth/token.ts`** - `POST /oauth/token`:
   - Parse `grant_type=authorization_code`, `code`, `code_verifier`, `client_id`, `redirect_uri`
   - Look up auth code from KV, verify not expired
   - Verify PKCE: `BASE64URL(SHA256(code_verifier)) == stored code_challenge`
   - Delete used code from KV
   - Sign and return JWT with 7-day expiry

### Phase 3: Middleware & Proxy
8. **`src/oauth/verify.ts`** - Hono middleware:
   - Extract Bearer token from Authorization header
   - Verify JWT signature and expiry
   - If invalid: return 401 with `WWW-Authenticate: Bearer resource_metadata="..."`
   - If valid: set client info on context, call next
9. **`src/proxy.ts`** - Proxy handler:
   - Rewrite URL to `ORIGIN_URL`
   - Replace Authorization header with `Bearer ${TANA_BEARER_TOKEN}`
   - Forward all other headers, method, body
   - Return origin response

### Phase 4: Wire Together
10. **`src/worker.ts`** - Hono app:
    - Mount metadata routes (no auth)
    - Mount `/oauth/register` (no auth)
    - Mount `/oauth/authorize` (no auth)
    - Mount `/oauth/token` (no auth)
    - Apply JWT verify middleware to all other routes
    - Mount proxy as catch-all

### Phase 5: Infrastructure
11. **`alchemy.run.ts`** - Modify:
    - Change tunnel hostname from `tana.nicobaier.com` to `tana-origin.nicobaier.com`
    - Add `KVNamespace("oauth-kv")`
    - Add `Worker("tana-proxy")` with entrypoint `./src/worker.ts`, bindings, and route on `tana.nicobaier.com/*`
    - Add `hono` as a dependency (or install separately)
12. **`.env.example`** - Add: `TANA_BEARER_TOKEN`, `AUTH_PASSWORD`, `JWT_SECRET`

### Phase 6: Install & Deploy
13. `bun add hono` - Install Hono
14. `bun alchemy deploy` - Deploy everything

## Verification

1. `bun alchemy deploy` succeeds
2. `curl https://tana.nicobaier.com/.well-known/oauth-protected-resource` returns metadata
3. `curl https://tana.nicobaier.com/.well-known/oauth-authorization-server` returns server metadata
4. `curl https://tana.nicobaier.com/mcp` returns 401 with `WWW-Authenticate` header
5. Add MCP server in Claude.ai with URL `https://tana.nicobaier.com` -> OAuth flow completes, tools work

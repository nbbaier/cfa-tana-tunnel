import { createMiddleware } from "hono/factory";
import type { Env } from "../types.js";
import { verifyJWT } from "./jwt.js";

const PUBLIC_PATHS = new Set(["/health", "/docs", "/openapi.json"]);

// Paths that require OAuth only (no PAT allowed)
const OAUTH_ONLY_PATHS = ["/mcp"];

function isOAuthOnly(pathname: string): boolean {
  return OAUTH_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export const jwtVerify = createMiddleware<Env>(async (c, next) => {
  if (PUBLIC_PATHS.has(new URL(c.req.url).pathname)) {
    return next();
  }

  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.log("[VERIFY] No Bearer token - returning 401 with discovery URL");
    const resourceMetadataUrl = `${c.env.PUBLIC_URL}/.well-known/oauth-protected-resource`;
    c.header(
      "WWW-Authenticate",
      `Bearer resource_metadata="${resourceMetadataUrl}"`,
    );
    return c.json({ error: "unauthorized", message: "Authentication required. Use OAuth or a Personal Access Token." }, 401);
  }

  const token = authHeader.slice(7);
  const pathname = new URL(c.req.url).pathname;

  // Try JWT first (works for all routes)
  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (payload) {
    console.log("[VERIFY] JWT valid - client:", payload.sub, "exp:", new Date(payload.exp * 1000).toISOString());
    c.set("clientId", payload.sub);
    return next();
  }

  // For non-OAuth-only routes, also accept PAT
  if (!isOAuthOnly(pathname) && c.env.API_TOKEN && token === c.env.API_TOKEN) {
    console.log("[VERIFY] PAT valid for path:", pathname);
    c.set("clientId", "pat-user");
    return next();
  }

  console.log("[VERIFY] Auth failed - path:", pathname, "token length:", token.length, "oauth_only:", isOAuthOnly(pathname));
  const resourceMetadataUrl = `${c.env.PUBLIC_URL}/.well-known/oauth-protected-resource`;
  c.header(
    "WWW-Authenticate",
    `Bearer resource_metadata="${resourceMetadataUrl}"`,
  );
  return c.json({ error: "invalid_token" }, 401);
});

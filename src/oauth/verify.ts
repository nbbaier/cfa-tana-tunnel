import { createMiddleware } from "hono/factory";
import type { Env } from "../types.js";
import { verifyJWT } from "./jwt.js";

const PUBLIC_PATHS = new Set(["/health"]);

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
    return c.json({ error: "unauthorized" }, 401);
  }

  const token = authHeader.slice(7);
  const payload = await verifyJWT(token, c.env.JWT_SECRET);

  if (!payload) {
    console.log("[VERIFY] JWT verification FAILED - token length:", token.length, "prefix:", token.slice(0, 20));
    const resourceMetadataUrl = `${c.env.PUBLIC_URL}/.well-known/oauth-protected-resource`;
    c.header(
      "WWW-Authenticate",
      `Bearer resource_metadata="${resourceMetadataUrl}"`,
    );
    return c.json({ error: "invalid_token" }, 401);
  }

  console.log("[VERIFY] JWT valid - client:", payload.sub, "exp:", new Date(payload.exp * 1000).toISOString());
  c.set("clientId", payload.sub);
  await next();
});

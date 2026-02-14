import { createMiddleware } from "hono/factory";
import type { Env } from "../types.js";
import { verifyJWT } from "./jwt.js";

export const jwtVerify = createMiddleware<Env>(async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
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
    const resourceMetadataUrl = `${c.env.PUBLIC_URL}/.well-known/oauth-protected-resource`;
    c.header(
      "WWW-Authenticate",
      `Bearer resource_metadata="${resourceMetadataUrl}"`,
    );
    return c.json({ error: "invalid_token" }, 401);
  }

  c.set("clientId", payload.sub);
  await next();
});

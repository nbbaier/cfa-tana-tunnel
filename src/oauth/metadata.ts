import { Hono } from "hono";
import type { Env } from "../types.js";

const metadata = new Hono<Env>();

metadata.get("/.well-known/oauth-protected-resource", (c) => {
  const publicUrl = c.env.PUBLIC_URL;
  return c.json({
    resource: publicUrl,
    authorization_servers: [publicUrl],
  });
});

metadata.get("/.well-known/oauth-authorization-server", (c) => {
  const publicUrl = c.env.PUBLIC_URL;
  return c.json({
    issuer: publicUrl,
    authorization_endpoint: `${publicUrl}/oauth/authorize`,
    token_endpoint: `${publicUrl}/oauth/token`,
    registration_endpoint: `${publicUrl}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });
});

export { metadata };

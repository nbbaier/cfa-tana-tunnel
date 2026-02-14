import { Hono } from "hono";
import type { Env, ClientRegistration } from "../types.js";

const register = new Hono<Env>();

register.post("/oauth/register", async (c) => {
  const body = await c.req.json();

  const redirectUris: string[] = body.redirect_uris;
  if (!redirectUris || !Array.isArray(redirectUris) || redirectUris.length === 0) {
    return c.json({ error: "invalid_client_metadata", error_description: "redirect_uris required" }, 400);
  }

  const clientId: string = body.client_uri || crypto.randomUUID();

  const registration: ClientRegistration = {
    client_id: clientId,
    client_name: body.client_name,
    redirect_uris: redirectUris,
    grant_types: body.grant_types || ["authorization_code"],
    response_types: body.response_types || ["code"],
    token_endpoint_auth_method: body.token_endpoint_auth_method || "none",
    client_uri: body.client_uri,
  };

  await c.env.OAUTH_KV.put(`client:${clientId}`, JSON.stringify(registration));

  return c.json({
    client_id: clientId,
    client_name: registration.client_name,
    redirect_uris: registration.redirect_uris,
    grant_types: registration.grant_types,
    response_types: registration.response_types,
    token_endpoint_auth_method: registration.token_endpoint_auth_method,
  }, 201);
});

export { register };

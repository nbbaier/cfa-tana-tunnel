import { Hono } from "hono";
import type { Env, ClientRegistration } from "../types.js";

const register = new Hono<Env>();

register.post("/oauth/register", async (c) => {
  const body = await c.req.json();
  console.log("[REGISTER] request body:", JSON.stringify(body));

  const redirectUris: string[] = body.redirect_uris;
  if (!redirectUris || !Array.isArray(redirectUris) || redirectUris.length === 0) {
    return c.json({ error: "invalid_client_metadata", error_description: "redirect_uris required" }, 400);
  }

  const clientId: string = body.client_uri || crypto.randomUUID();

  // Generate client_secret if the client requests an auth method that needs one
  const authMethod = body.token_endpoint_auth_method || "none";
  let clientSecret: string | undefined;
  if (authMethod !== "none") {
    const secretBytes = new Uint8Array(32);
    crypto.getRandomValues(secretBytes);
    clientSecret = Array.from(secretBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  const registration: ClientRegistration = {
    client_id: clientId,
    client_secret: clientSecret,
    client_name: body.client_name,
    redirect_uris: redirectUris,
    grant_types: body.grant_types || ["authorization_code"],
    response_types: body.response_types || ["code"],
    token_endpoint_auth_method: authMethod,
    scope: body.scope,
    client_uri: body.client_uri,
  };

  await c.env.OAUTH_KV.put(`client:${clientId}`, JSON.stringify(registration));
  console.log("[REGISTER] stored client:", clientId, "redirect_uris:", redirectUris, "auth_method:", authMethod, "has_secret:", !!clientSecret);

  const response: Record<string, unknown> = {
    client_id: clientId,
    client_name: registration.client_name,
    redirect_uris: registration.redirect_uris,
    grant_types: registration.grant_types,
    response_types: registration.response_types,
    token_endpoint_auth_method: registration.token_endpoint_auth_method,
  };
  if (clientSecret) {
    response.client_secret = clientSecret;
  }
  if (registration.scope) {
    response.scope = registration.scope;
  }

  return c.json(response, 201);
});

export { register };

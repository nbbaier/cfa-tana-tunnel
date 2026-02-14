import { Hono } from "hono";
import type { Env, AuthCodeData, JWTPayload } from "../types.js";
import { createJWT } from "./jwt.js";

const token = new Hono<Env>();

token.post("/oauth/token", async (c) => {
  const body = await c.req.parseBody();
  const grantType = body.grant_type as string;
  const code = body.code as string;
  const codeVerifier = body.code_verifier as string;
  const clientId = body.client_id as string;
  const redirectUri = body.redirect_uri as string;

  console.log("[TOKEN] params:", JSON.stringify({
    grant_type: grantType,
    client_id: clientId,
    redirect_uri: redirectUri,
    has_code: !!code,
    has_code_verifier: !!codeVerifier,
  }));

  // Handle refresh_token grant
  if (grantType === "refresh_token") {
    const refreshToken = body.refresh_token as string;
    if (!refreshToken || !clientId) {
      return c.json({ error: "invalid_request", error_description: "Missing required parameters" }, 400);
    }

    // Look up refresh token from KV
    const storedRefresh = await c.env.OAUTH_KV.get(`refresh:${refreshToken}`);
    if (!storedRefresh) {
      console.log("[TOKEN] REJECTED: invalid refresh token");
      return c.json({ error: "invalid_grant", error_description: "Invalid refresh token" }, 400);
    }

    const refreshData = JSON.parse(storedRefresh) as { client_id: string; scope?: string };
    if (refreshData.client_id !== clientId) {
      console.log("[TOKEN] REJECTED: refresh token client_id mismatch");
      return c.json({ error: "invalid_grant", error_description: "Client ID mismatch" }, 400);
    }

    // Issue new tokens
    const now = Math.floor(Date.now() / 1000);
    const accessToken = await createJWT(
      { sub: clientId, iss: c.env.PUBLIC_URL, iat: now, exp: now + 7 * 24 * 60 * 60 },
      c.env.JWT_SECRET,
    );

    // Rotate refresh token
    const newRefreshToken = generateRandomToken();
    await c.env.OAUTH_KV.delete(`refresh:${refreshToken}`);
    await c.env.OAUTH_KV.put(`refresh:${newRefreshToken}`, JSON.stringify(refreshData), { expirationTtl: 30 * 24 * 60 * 60 });

    console.log("[TOKEN] Refreshed tokens for client:", clientId);

    const response: Record<string, unknown> = {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 7 * 24 * 60 * 60,
      refresh_token: newRefreshToken,
    };
    if (refreshData.scope) {
      response.scope = refreshData.scope;
    }
    return c.json(response);
  }

  if (grantType !== "authorization_code") {
    console.log("[TOKEN] REJECTED: unsupported_grant_type:", grantType);
    return c.json({ error: "unsupported_grant_type" }, 400);
  }

  if (!code || !codeVerifier || !clientId) {
    console.log("[TOKEN] REJECTED: missing params - code:", !!code, "verifier:", !!codeVerifier, "client_id:", !!clientId);
    return c.json({ error: "invalid_request", error_description: "Missing required parameters" }, 400);
  }

  // Look up auth code from KV
  const storedData = await c.env.OAUTH_KV.get(`authcode:${code}`);
  if (!storedData) {
    console.log("[TOKEN] REJECTED: auth code not found or expired");
    return c.json({ error: "invalid_grant", error_description: "Invalid or expired authorization code" }, 400);
  }

  const authCodeData: AuthCodeData = JSON.parse(storedData);

  console.log("[TOKEN] stored auth code data:", JSON.stringify({
    stored_client_id: authCodeData.client_id,
    stored_redirect_uri: authCodeData.redirect_uri,
    request_client_id: clientId,
    request_redirect_uri: redirectUri,
    client_id_match: authCodeData.client_id === clientId,
    redirect_uri_match: !redirectUri || authCodeData.redirect_uri === redirectUri,
  }));

  // Verify client_id matches
  if (authCodeData.client_id !== clientId) {
    console.log("[TOKEN] REJECTED: client_id mismatch");
    return c.json({ error: "invalid_grant", error_description: "Client ID mismatch" }, 400);
  }

  // Verify redirect_uri matches (if provided)
  if (redirectUri && authCodeData.redirect_uri !== redirectUri) {
    console.log("[TOKEN] REJECTED: redirect_uri mismatch");
    return c.json({ error: "invalid_grant", error_description: "Redirect URI mismatch" }, 400);
  }

  // Verify PKCE: BASE64URL(SHA256(code_verifier)) == code_challenge
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(codeVerifier));
  const computedChallenge = base64UrlEncode(digest);

  if (computedChallenge !== authCodeData.code_challenge) {
    console.log("[TOKEN] REJECTED: PKCE failed - computed:", computedChallenge, "stored:", authCodeData.code_challenge);
    return c.json({ error: "invalid_grant", error_description: "PKCE verification failed" }, 400);
  }

  console.log("[TOKEN] PKCE verified, issuing JWT for client:", clientId);

  // Delete used auth code
  await c.env.OAUTH_KV.delete(`authcode:${code}`);

  // Create JWT with 7-day expiry
  const now = Math.floor(Date.now() / 1000);
  const payload: JWTPayload = {
    sub: clientId,
    iss: c.env.PUBLIC_URL,
    iat: now,
    exp: now + 7 * 24 * 60 * 60, // 7 days
  };

  const accessToken = await createJWT(payload, c.env.JWT_SECRET);

  // Look up client registration to check for refresh_token grant and scope
  const clientData = await c.env.OAUTH_KV.get(`client:${clientId}`);
  const clientReg = clientData ? JSON.parse(clientData) : null;

  const response: Record<string, unknown> = {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 7 * 24 * 60 * 60,
  };

  // Issue refresh token if the client registered for it
  if (clientReg?.grant_types?.includes("refresh_token")) {
    const refreshToken = generateRandomToken();
    await c.env.OAUTH_KV.put(
      `refresh:${refreshToken}`,
      JSON.stringify({ client_id: clientId, scope: clientReg.scope }),
      { expirationTtl: 30 * 24 * 60 * 60 }, // 30 days
    );
    response.refresh_token = refreshToken;
    console.log("[TOKEN] issued refresh token for client:", clientId);
  }

  // Echo back scope if the client registered with one
  if (clientReg?.scope) {
    response.scope = clientReg.scope;
  }

  return c.json(response);
});

function generateRandomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64UrlEncode(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export { token };

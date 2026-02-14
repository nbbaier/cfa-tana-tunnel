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

  if (grantType !== "authorization_code") {
    return c.json({ error: "unsupported_grant_type" }, 400);
  }

  if (!code || !codeVerifier || !clientId) {
    return c.json({ error: "invalid_request", error_description: "Missing required parameters" }, 400);
  }

  // Look up auth code from KV
  const storedData = await c.env.OAUTH_KV.get(`authcode:${code}`);
  if (!storedData) {
    return c.json({ error: "invalid_grant", error_description: "Invalid or expired authorization code" }, 400);
  }

  const authCodeData: AuthCodeData = JSON.parse(storedData);

  // Verify client_id matches
  if (authCodeData.client_id !== clientId) {
    return c.json({ error: "invalid_grant", error_description: "Client ID mismatch" }, 400);
  }

  // Verify redirect_uri matches (if provided)
  if (redirectUri && authCodeData.redirect_uri !== redirectUri) {
    return c.json({ error: "invalid_grant", error_description: "Redirect URI mismatch" }, 400);
  }

  // Verify PKCE: BASE64URL(SHA256(code_verifier)) == code_challenge
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(codeVerifier));
  const computedChallenge = base64UrlEncode(digest);

  if (computedChallenge !== authCodeData.code_challenge) {
    return c.json({ error: "invalid_grant", error_description: "PKCE verification failed" }, 400);
  }

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

  return c.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 7 * 24 * 60 * 60,
  });
});

function base64UrlEncode(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export { token };

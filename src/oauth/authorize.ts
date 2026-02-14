import { Hono } from "hono";
import type { Env, AuthCodeData } from "../types.js";
import { renderConsentPage } from "../consent.js";

const authorize = new Hono<Env>();

// GET: Show consent page
authorize.get("/oauth/authorize", (c) => {
  const clientId = c.req.query("client_id") || "";
  const redirectUri = c.req.query("redirect_uri") || "";
  const state = c.req.query("state");
  const codeChallenge = c.req.query("code_challenge") || "";
  const codeChallengeMethod = c.req.query("code_challenge_method") || "S256";
  const responseType = c.req.query("response_type") || "code";

  if (!clientId || !redirectUri || !codeChallenge) {
    return c.text("Missing required parameters: client_id, redirect_uri, code_challenge", 400);
  }

  if (codeChallengeMethod !== "S256") {
    return c.text("Only S256 code_challenge_method is supported", 400);
  }

  const html = renderConsentPage({
    client_id: clientId,
    redirect_uri: redirectUri,
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    response_type: responseType,
  });

  return c.html(html);
});

// POST: Validate password, issue auth code, redirect
authorize.post("/oauth/authorize", async (c) => {
  const body = await c.req.parseBody();
  const clientId = body.client_id as string;
  const redirectUri = body.redirect_uri as string;
  const state = body.state as string;
  const codeChallenge = body.code_challenge as string;
  const codeChallengeMethod = body.code_challenge_method as string;
  const responseType = body.response_type as string;
  const password = body.password as string;

  if (!clientId || !redirectUri || !codeChallenge || !password) {
    return c.text("Missing required fields", 400);
  }

  // Validate password
  if (password !== c.env.AUTH_PASSWORD) {
    const html = renderConsentPage({
      client_id: clientId,
      redirect_uri: redirectUri,
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      response_type: responseType,
      error: "Invalid password. Please try again.",
    });
    return c.html(html, 403);
  }

  // Generate auth code
  const codeBytes = new Uint8Array(32);
  crypto.getRandomValues(codeBytes);
  const code = Array.from(codeBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Store auth code data in KV with 5 min TTL
  const authCodeData: AuthCodeData = {
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
  };

  await c.env.OAUTH_KV.put(`authcode:${code}`, JSON.stringify(authCodeData), {
    expirationTtl: 300,
  });

  // Redirect back to client with auth code
  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set("code", code);
  if (state) {
    redirectUrl.searchParams.set("state", state);
  }

  return c.redirect(redirectUrl.toString(), 302);
});

export { authorize };

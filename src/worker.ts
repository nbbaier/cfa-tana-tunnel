import { Hono } from "hono";
import type { Env } from "./types.js";
import { metadata } from "./oauth/metadata.js";
import { register } from "./oauth/register.js";
import { authorize } from "./oauth/authorize.js";
import { token } from "./oauth/token.js";
import { jwtVerify } from "./oauth/verify.js";
import { proxy } from "./proxy.js";

const app = new Hono<Env>();

// Global request logging middleware
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  const authHeader = c.req.header("Authorization");

  const logData: Record<string, unknown> = {
    method: c.req.method,
    path: url.pathname,
    search: url.search,
    origin: c.req.header("Origin") || null,
    referer: c.req.header("Referer") || null,
    contentType: c.req.header("Content-Type") || null,
    auth: authHeader
      ? `${authHeader.slice(0, 15)}...${authHeader.slice(-6)}`
      : null,
  };

  // Log request body for POST requests (clone to avoid consuming)
  if (c.req.method === "POST") {
    try {
      const clone = c.req.raw.clone();
      const ct = c.req.header("Content-Type") || "";
      if (ct.includes("application/x-www-form-urlencoded")) {
        const text = await clone.text();
        // Redact password values
        const redacted = text.replace(
          /password=[^&]*/g,
          "password=[REDACTED]",
        );
        logData.body = redacted;
      } else if (ct.includes("application/json")) {
        const json = await clone.json();
        logData.body = json;
      }
    } catch {
      logData.body = "[unreadable]";
    }
  }

  console.log("[REQ]", JSON.stringify(logData));

  await next();

  console.log("[RES]", JSON.stringify({
    path: url.pathname,
    status: c.res.status,
  }));
});

// Health check (no auth)
app.get("/health", (c) => {
  console.log("[HEALTH] hit");
  return c.json({ ok: true, ts: Date.now() });
});

// Public routes (no auth required)
app.route("/", metadata);
app.route("/", register);
app.route("/", authorize);
app.route("/", token);

// All other routes require JWT authentication
app.use("*", jwtVerify);

// Proxy authenticated requests to origin
app.route("/", proxy);

export default app;

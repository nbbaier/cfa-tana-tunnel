import { Hono } from "hono";
import type { Env } from "./types.js";
import { metadata } from "./oauth/metadata.js";
import { register } from "./oauth/register.js";
import { authorize } from "./oauth/authorize.js";
import { token } from "./oauth/token.js";
import { jwtVerify } from "./oauth/verify.js";
import { proxy } from "./proxy.js";

const app = new Hono<Env>();

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

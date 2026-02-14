import { Hono } from "hono";
import type { Env } from "./types.js";

const proxy = new Hono<Env>();

proxy.all("*", async (c) => {
  const originUrl = new URL(c.req.url);
  originUrl.hostname = new URL(c.env.ORIGIN_URL).hostname;
  originUrl.protocol = new URL(c.env.ORIGIN_URL).protocol;
  originUrl.port = "";

  // Build headers, replacing Authorization with Tana's bearer token
  const headers = new Headers(c.req.raw.headers);
  headers.set("Authorization", `Bearer ${c.env.TANA_BEARER_TOKEN}`);
  // Remove host header so fetch uses the correct one
  headers.delete("host");

  const response = await fetch(originUrl.toString(), {
    method: c.req.method,
    headers,
    body: c.req.raw.body,
    // @ts-expect-error - duplex is needed for streaming request bodies
    duplex: "half",
  });

  // Return the response from origin
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
});

export { proxy };

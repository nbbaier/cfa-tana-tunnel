import alchemy from "alchemy";
import { KVNamespace, Tunnel, Worker, WranglerJson } from "alchemy/cloudflare";
import { CloudflareStateStore } from "alchemy/state";

const app = await alchemy("cfa-tana-tunnel", {
	stateStore: (scope) => new CloudflareStateStore(scope),
	password: process.env.ALCHEMY_PASSWORD,
	adopt: true,
});

// Tunnel now routes to tana-origin.nicobaier.com
const tunnel = await Tunnel("tana-mcp", {
	name: "tana-mcp",
	adopt: true,
	ingress: [
		{
			hostname: "tana-origin.nicobaier.com",
			service: "http://localhost:8262",
			originRequest: { httpHostHeader: "localhost:8262" },
		},
		{ service: "http_status:404" },
	],
});

console.log("--------------------------------");
console.log("Tunnel Name:", tunnel.name);
console.log("Tunnel ID:", tunnel.tunnelId);
console.log("Run locally with:");
console.log(`  cloudflared tunnel run --token ${tunnel.token.unencrypted}`);
console.log("--------------------------------");

// KV namespace for OAuth state (auth codes + client registrations)
const oauthKv = await KVNamespace("oauth-kv", {
	title: "tana-proxy-oauth-kv",
});

// OAuth proxy Worker at tana.nicobaier.com
const worker = await Worker("tana-proxy", {
	name: `tana-proxy-${app.stage}`,
	entrypoint: "./src/worker.ts",
	url: false,
	adopt: true,
	bindings: {
		OAUTH_KV: oauthKv,
		TANA_BEARER_TOKEN: alchemy.secret(process.env.TANA_BEARER_TOKEN),
		AUTH_PASSWORD: alchemy.secret(process.env.AUTH_PASSWORD),
		JWT_SECRET: alchemy.secret(process.env.JWT_SECRET),
		ORIGIN_URL: "https://tana-origin.nicobaier.com",
		PUBLIC_URL: "https://tana.nicobaier.com",
	},
	routes: [
		{
			pattern: "tana.nicobaier.com/*",
		},
	],
});

await WranglerJson({ worker });

console.log("Worker:", worker.name);

await app.finalize();

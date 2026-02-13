import alchemy from "alchemy";
import { Tunnel } from "alchemy/cloudflare";

const app = await alchemy("cfa-tana-tunnel");

const tunnel = await Tunnel("tana-mcp", {
	name: "tana-mcp",
	adopt: true,
	ingress: [
		{
			hostname: "tana.nicobaier.com",
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

await app.finalize();

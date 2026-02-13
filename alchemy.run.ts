import alchemy from "alchemy";
import { GitHubComment } from "alchemy/github";
import { CloudflareStateStore } from "alchemy/state";
import { KVNamespace, Worker } from "alchemy/cloudflare";

const app = await alchemy("cfa-tana-tunnel", {
  stateStore: (scope) => new CloudflareStateStore(scope),
});

const kv = await KVNamespace("kv", {
  title: "kv",
});

export const worker = await Worker("worker", {
  entrypoint: "src/index.ts",
  bindings: {
    KV: kv,
  },
});

console.log(worker.url);


if (process.env.PULL_REQUEST) {
  const previewUrl = worker.url;

  await GitHubComment("pr-preview-comment", {
    owner: process.env.GITHUB_REPOSITORY_OWNER || "your-username",
    repository: process.env.GITHUB_REPOSITORY_NAME || "cfa-tana-tunnel",
    issueNumber: Number(process.env.PULL_REQUEST),
    body: `
## 🚀 Preview Deployed

Your preview is ready!

**Preview URL:** ${previewUrl}

This preview was built from commit ${process.env.GITHUB_SHA}

---
<sub>🤖 This comment will be updated automatically when you push new commits to this PR.</sub>`,
  });
}

await app.finalize();

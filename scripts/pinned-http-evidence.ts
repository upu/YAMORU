import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

export function httpSourceHashes() {
  const root = new URL("../", import.meta.url);
  const directory = "src/features/integration/notifications/http/";
  const files = [
    ...readdirSync(new URL(directory, root)).filter((name) => name.endsWith(".ts")).map((name) => `${directory}${name}`),
    "src/features/integration/notifications/worker-transport.mjs", "src/features/integration/notifications/webhook-transport.ts", "src/features/integration/notifications/event-crypto.ts",
    "packages/pinned-tls/generated/tls.js", "packages/pinned-tls/probe/http-worker.js", "packages/pinned-tls/probe/http-wrangler.jsonc",
    "scripts/pinned-http-probe.ts", "scripts/pinned-http-evidence.ts",
  ].sort();
  return Object.fromEntries(files.map((filename) => [filename, createHash("sha256").update(readFileSync(new URL(filename, root), "utf8").replaceAll("\r\n", "\n")).digest("hex")]));
}

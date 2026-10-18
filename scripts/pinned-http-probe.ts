import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { httpSourceHashes } from "./pinned-http-evidence.ts";

const origin = new URL(process.argv[2] ?? "http://127.0.0.1:8792");
if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Pass only the loopback Wrangler origin");
type ProbeResult = { testCase: string; ok: boolean; status?: number; headOnly?: boolean; reason?: string; requestStarted?: boolean; elapsedMs: number; echo?: { messageMatches: boolean; webhookIdMatches: boolean; signatureMatches: boolean; privateHeadersAbsent: boolean } };
const results: ProbeResult[] = [];
const sourceHashes = httpSourceHashes();
const failures: Partial<Record<string, { reason: string; requestStarted: boolean }>> = {
  large_body: { reason: "payload_too_large", requestStarted: true }, redirect: { reason: "redirect_not_allowed", requestStarted: true },
  wrong: { reason: "unreachable", requestStarted: false }, expired: { reason: "unreachable", requestStarted: false }, selfsigned: { reason: "unreachable", requestStarted: false },
  private: { reason: "blocked_url", requestStarted: false }, delay: { reason: "timeout", requestStarted: true },
};
for (const testCase of ["echo", "status", "large_head", ...Object.keys(failures)]) {
  const response = await fetch(new URL(`/?case=${testCase}`, origin), { signal: AbortSignal.timeout(15_000), redirect: "error" });
  assert.equal(response.status, 200);
  const value = await response.json() as ProbeResult;
  assert.equal(value.testCase, testCase);
  const expected = failures[testCase];
  if (expected) {
    assert.equal(value.ok, false, JSON.stringify(value));
    assert.equal(value.reason, expected.reason, JSON.stringify(value));
    assert.equal(value.requestStarted, expected.requestStarted, JSON.stringify(value));
  } else {
    assert.equal(value.ok, true, JSON.stringify(value));
    assert.equal(value.status, testCase === "status" ? 202 : 200);
    if (testCase === "echo") assert.deepEqual(value.echo, { messageMatches: true, webhookIdMatches: true, signatureMatches: true, privateHeadersAbsent: true });
    else assert.equal(value.headOnly, true);
  }
  if (testCase === "delay") assert(value.elapsedMs >= 9000 && value.elapsedMs < 14_000, JSON.stringify(value));
  results.push(value);
}
const bytes = readFileSync(new URL("../packages/pinned-tls/generated/tls_bg.wasm", import.meta.url));
assert.deepEqual(httpSourceHashes(), sourceHashes, "HTTP source changed during the live probe");
console.log(JSON.stringify({ captured_at: new Date().toISOString(), wasm_sha256: createHash("sha256").update(bytes).digest("hex"), source_sha256: sourceHashes, results }, null, 2));

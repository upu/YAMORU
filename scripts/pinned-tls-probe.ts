import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const origin = new URL(process.argv[2] ?? "http://127.0.0.1:8791");
if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Pass only the loopback Wrangler origin");
type ProbeResult = { ok: boolean; testCase: string; handshakeComplete: boolean; applicationBytes: number; statusLine?: string; error?: string; peerClosed?: boolean };
const results: ProbeResult[] = [];
for (const testCase of ["valid", "wrong", "expired", "selfsigned", "close_notify"]) {
  const url = new URL(`/?case=${testCase}`, origin);
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "error" });
  assert.equal(response.status, 200);
  const result = await response.json() as ProbeResult;
  assert.equal(result.testCase, testCase);
  if (testCase === "valid" || testCase === "close_notify") {
    assert.equal(result.ok, true);
    assert.equal(result.handshakeComplete, true);
    assert.equal(result.statusLine, "HTTP/1.1 200 OK");
    assert.equal(result.applicationBytes > 0, true);
    if (testCase === "close_notify") assert.equal(result.peerClosed, true);
  } else {
    assert.equal(result.ok, false);
    assert.equal(result.handshakeComplete, false);
    assert.equal(result.applicationBytes, 0);
    assert.match(result.error ?? "", /invalid peer certificate/u);
  }
  results.push(result);
}
const wasm = readFileSync(new URL("../packages/pinned-tls/generated/tls_bg.wasm", import.meta.url));
console.log(JSON.stringify({ captured_at: new Date().toISOString(), wasm_sha256: createHash("sha256").update(wasm).digest("hex"), results }, null, 2));

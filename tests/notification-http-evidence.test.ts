// @vitest-environment node
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { httpSourceHashes } from "../scripts/pinned-http-evidence";

it("matches the checked-in HTTP implementation and TLS binary to the real edge probe", () => {
  const evidence = JSON.parse(readFileSync(new URL("../packages/pinned-tls/probe/http-edge-result-2026-10-18.json", import.meta.url), "utf8")) as {
    wasm_sha256: string; source_sha256: Record<string, string>; results: { testCase: string; ok: boolean; reason?: string; requestStarted?: boolean }[];
  };
  expect(evidence.source_sha256).toEqual(httpSourceHashes());
  const wasm = readFileSync(new URL("../packages/pinned-tls/generated/tls_bg.wasm", import.meta.url));
  expect(evidence.wasm_sha256).toBe(createHash("sha256").update(wasm).digest("hex"));
  expect(evidence.results.map((result) => result.testCase)).toEqual(["echo", "status", "large_head", "large_body", "redirect", "wrong", "expired", "selfsigned", "private", "delay"]);
  expect(evidence.results.find((result) => result.testCase === "wrong")).toMatchObject({ ok: false, requestStarted: false });
  expect(evidence.results.find((result) => result.testCase === "delay")).toMatchObject({ ok: false, reason: "timeout", requestStarted: true });
});

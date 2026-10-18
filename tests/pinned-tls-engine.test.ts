// @vitest-environment node
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { initSync, TlsClient } from "../packages/pinned-tls/generated/tls";

initSync({ module: new WebAssembly.Module(readFileSync(new URL("../packages/pinned-tls/generated/tls_bg.wasm", import.meta.url))) });

function serverNames(record: Uint8Array) {
  const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
  expect(record[0]).toBe(22);
  expect(record[5]).toBe(1);
  let offset = 9 + 2 + 32;
  offset += 1 + record[offset];
  offset += 2 + view.getUint16(offset);
  offset += 1 + record[offset];
  const end = offset + 2 + view.getUint16(offset);
  offset += 2;
  const names = [];
  while (offset < end) {
    const type = view.getUint16(offset);
    const length = view.getUint16(offset + 2);
    if (type === 0) {
      expect(view.getUint16(offset + 4)).toBe(length - 2);
      expect(record[offset + 6]).toBe(0);
      const nameLength = view.getUint16(offset + 7);
      names.push(new TextDecoder().decode(record.subarray(offset + 9, offset + 9 + nameLength)));
    }
    offset += 4 + length;
  }
  return names;
}

describe("source-built TLS engine", () => {
  it("sends the original DNS hostname in the actual ClientHello SNI", () => {
    const tls = new TlsClient("badssl.com");
    try { expect(serverNames(tls.take_tls())).toEqual(["badssl.com"]); }
    finally { tls.free(); }
  });

  it("uses IP certificate identity without emitting IP literals as SNI", () => {
    const tls = new TlsClient("192.0.2.1");
    try { expect(serverNames(tls.take_tls())).toEqual([]); }
    finally { tls.free(); }
  });

  it("does not buffer any application payload before authenticated handshake completion", () => {
    const tls = new TlsClient("badssl.com");
    try {
      expect(tls.handshaking()).toBe(true);
      tls.take_tls();
      expect(() => { tls.write_application(new TextEncoder().encode("PRIVATE PAYLOAD")); }).toThrow("TLS handshake incomplete");
      expect(tls.take_tls()).toHaveLength(0);
    } finally { tls.free(); }
  });

  it("latches invalid TLS as fatal instead of accepting a later application write", () => {
    const tls = new TlsClient("badssl.com");
    try {
      expect(() => { tls.receive_tls(new TextEncoder().encode("HTTP/1.1 200 OK\r\n\r\n")); }).toThrow();
      expect(() => { tls.write_application(new Uint8Array([1])); }).toThrow("TLS connection failed");
      expect(() => tls.take_tls()).toThrow("TLS connection failed");
    } finally { tls.free(); }
  });

  it("bounds each inbound feed before handing it to the TLS parser", () => {
    const tls = new TlsClient("badssl.com");
    try { expect(() => { tls.receive_tls(new Uint8Array(65_537)); }).toThrow("TLS input too large"); }
    finally { tls.free(); }
  });

  it.each(["", "not a host", "https://badssl.com", "badssl.com:443"])("rejects an invalid peer identity: %s", (identity) => {
    expect(() => new TlsClient(identity)).toThrow();
  });

  it("keeps generated binaries and source provenance in agreement", () => {
    const manifest = JSON.parse(readFileSync(new URL("../packages/pinned-tls/generated/manifest.json", import.meta.url), "utf8")) as {
      inputs: Record<string, string>; outputs: Record<string, string>;
    };
    const edge = JSON.parse(readFileSync(new URL("../packages/pinned-tls/probe/edge-result-2026-10-18.json", import.meta.url), "utf8")) as { wasm_sha256: string };
    expect(manifest.outputs["tls_bg.wasm"]).toBe(edge.wasm_sha256);
    for (const [filename, checksum] of Object.entries(manifest.inputs)) {
      const source = readFileSync(new URL(`../${filename}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
      expect(createHash("sha256").update(source).digest("hex"), filename).toBe(checksum);
    }
    for (const [filename, checksum] of Object.entries(manifest.outputs)) {
      const bytes = readFileSync(new URL(`../packages/pinned-tls/generated/${filename}`, import.meta.url));
      expect(createHash("sha256").update(bytes).digest("hex"), filename).toBe(checksum);
    }
  });
});

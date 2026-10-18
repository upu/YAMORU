// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readPinnedHttpResponse } from "../src/features/integration/notifications/http/response";

function wireSource(wire: string, cut = 16_384) {
  const bytes = new TextEncoder().encode(wire);
  let offset = 0;
  return vi.fn(() => {
    if (offset >= bytes.length) return Promise.resolve(null);
    const chunk = bytes.slice(offset, offset + cut);
    offset += chunk.length;
    return Promise.resolve(chunk);
  });
}
const parse = (wire: string, headOnly = false, cut = 16_384) => readPinnedHttpResponse(wireSource(wire, cut), { headOnly });

describe("bounded HTTP response framing", () => {
  it.each([1, 2, 7, 16_384])("reads split Content-Length headers and UTF-8 bytes (%i)", async (cut) => {
    const body = '{"challenge":"あ"}';
    const size = new TextEncoder().encode(body).length;
    const response = await parse(`HTTP/1.1 200 OK\r\nContent-Length: ${String(size)}\r\nX-Test: yes\r\n\r\n${body}`, false, cut);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-test")).toBe("yes");
    expect(await response.text()).toBe(body);
  });

  it("decodes chunked bytes with extensions and bounded trailers", async () => {
    const response = await parse('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3;demo=yes\r\nabc\r\n2\r\nde\r\n0\r\nX-Trailer: ignored\r\n\r\n', false, 1);
    expect(await response.text()).toBe("abcde");
    expect(response.headers.has("x-trailer")).toBe(false);
    expect(response.headers.has("transfer-encoding")).toBe(false);
    expect(response.headers.get("content-length")).toBe("5");
  });

  it("reads a close-delimited body only after the source reports authenticated TLS closure", async () => {
    const response = await parse("HTTP/1.0 200 OK\r\nConnection: close\r\n\r\n{}", false, 1);
    expect(await response.text()).toBe("{}");
  });

  it.each([204, 205, 304])("does not wait for a nonexistent %i response body", async (status) => {
    const read = vi.fn().mockResolvedValueOnce(new TextEncoder().encode(`HTTP/1.1 ${String(status)} Empty\r\n\r\n`));
    const response = await readPinnedHttpResponse(read, { headOnly: false });
    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("does not consume a successful notification body's declared size in head-only mode", async () => {
    const read = vi.fn().mockResolvedValueOnce(new TextEncoder().encode("HTTP/1.1 202 Accepted\r\nContent-Length: 1000000\r\n\r\n"));
    const response = await readPinnedHttpResponse(read, { headOnly: true });
    expect(response.status).toBe(202);
    expect(response.body).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("returns redirect headers without following or reading the redirect body", async () => {
    const read = vi.fn().mockResolvedValueOnce(new TextEncoder().encode("HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1/\r\nContent-Length: 999999\r\n\r\n"));
    const response = await readPinnedHttpResponse(read, { headOnly: false });
    expect(response.status).toBe(302);
    expect(response.body).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("skips bounded informational responses before the final status", async () => {
    const response = await parse("HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 103 Early Hints\r\nLink: </asset>\r\n\r\nHTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}", false, 3);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("{}");
  });

  it.each([
    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\n{}",
    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nTransfer-Encoding: chunked\r\n\r\n",
    "HTTP/1.1 200 OK\r\nContent-Length: -1\r\n\r\n",
    "HTTP/1.1 200 OK\r\nContent-Length: 2,2\r\n\r\n{}",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: gzip, chunked\r\n\r\n",
    "HTTP/1.1 200 OK\r\n Folded: no\r\n\r\n",
    "HTTP/1.1 200 OK\nContent-Length: 0\n\n",
    "HTTP/2 200 OK\r\n\r\n",
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n",
    "HTTP/1.1 200 OK\r\nBad Name: value\r\n\r\n",
    "HTTP/1.1 200 OK\r\nX-Test: value\u0000bad\r\n\r\n",
  ])("rejects ambiguous or malformed HTTP headers", async (wire) => {
    await expect(parse(wire)).rejects.toMatchObject({ reason: "unreachable", requestStarted: true });
  });

  it.each([
    "HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nab",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nZ\r\n",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nab",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1\r\naXX0\r\n\r\n",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n0\r\nContent-Length: 0\r\n\r\n",
    "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: 0\r\n\r\n",
  ])("rejects truncated or unsupported body framing", async (wire) => {
    await expect(parse(wire, false, 2)).rejects.toMatchObject({ reason: "unreachable" });
  });

  it.each([
    "HTTP/1.1 200 OK\r\nContent-Length: 4097\r\n\r\n",
    `HTTP/1.0 200 OK\r\n\r\n${"x".repeat(4097)}`,
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1001\r\n",
  ])("rejects verification responses above 4 KiB", async (wire) => {
    await expect(parse(wire)).rejects.toMatchObject({ reason: "payload_too_large", requestStarted: true });
  });

  it("accepts exactly 4 KiB without demanding a connection close for Content-Length", async () => {
    const response = await parse(`HTTP/1.1 200 OK\r\nContent-Length: 4096\r\n\r\n${"x".repeat(4096)}`);
    expect((await response.arrayBuffer()).byteLength).toBe(4096);
  });

  it("bounds all header blocks and informational response counts", async () => {
    await expect(parse(`HTTP/1.1 200 OK\r\nX-Large: ${"x".repeat(16_384)}\r\n\r\n`)).rejects.toMatchObject({ reason: "unreachable" });
    await expect(parse(`${"HTTP/1.1 100 Continue\r\n\r\n".repeat(5)}HTTP/1.1 200 OK\r\n\r\n`)).rejects.toMatchObject({ reason: "unreachable" });
  });
});

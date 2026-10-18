// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPinnedHttpConnector } from "../src/features/integration/notifications/http/pinned-connector";
import { createPinnedWebhookTransport } from "../src/features/integration/notifications/webhook-transport";
import { pinnedRequest, tcpFixture, textBytes } from "./support/pinned-tcp";

afterEach(() => { vi.restoreAllMocks(); });
describe("pinned TCP/TLS HTTP exchange", () => {
  it("connects by checked IP, authenticates the original name, then writes UTF-8 POST once", async () => {
    const f = tcpFixture();
    const connect = createPinnedHttpConnector(f);
    const response = await connect(pinnedRequest({ headers: { authorization: "must-not-forward", cookie: "must-not-forward", "transfer-encoding": "chunked", host: "wrong" } }));
    expect(await response.text()).toBe("{}");
    expect(f.openTcp).toHaveBeenCalledExactlyOnceWith({ hostname: "8.8.8.8", port: 443 });
    expect(f.createTls).toHaveBeenCalledExactlyOnceWith("receiver.example.com");
    const sent = new TextDecoder().decode(f.writes[1]);
    expect(sent).toContain("POST /events?test=1 HTTP/1.1\r\n");
    expect(sent).toContain("host: receiver.example.com\r\n");
    expect(sent).toContain(`content-length: ${String(textBytes(pinnedRequest().body).length)}\r\n`);
    expect(sent).toContain("accept-encoding: identity\r\n");
    expect(sent).not.toContain("must-not-forward");
    expect(sent).not.toContain("transfer-encoding:");
    expect(sent.endsWith(pinnedRequest().body)).toBe(true);
    expect(f.socket.close).toHaveBeenCalledTimes(1);
    expect(f.tls.free).toHaveBeenCalledTimes(1);
  });

  it("never hands application bytes to a rejected TLS session or retries the TCP request", async () => {
    const f = tcpFixture();
    f.tls.receive_tls.mockImplementation(() => { throw new Error("fixture certificate failure"); });
    await expect(createPinnedHttpConnector(f)(pinnedRequest())).rejects.toMatchObject({ reason: "unreachable", requestStarted: false });
    expect(f.tls.write_application).not.toHaveBeenCalled();
    expect(f.openTcp).toHaveBeenCalledTimes(1);
    expect(f.socket.close).toHaveBeenCalledTimes(1);
    expect(f.tls.free).toHaveBeenCalledTimes(1);
  });

  it("bounds each application write while supporting the existing 256 KiB payload limit", async () => {
    const f = tcpFixture();
    await createPinnedHttpConnector(f)(pinnedRequest({ body: "x".repeat(262_144), readResponseBody: false }));
    expect(f.tls.write_application.mock.calls.every(([bytes]) => bytes.length <= 16_384)).toBe(true);
    const payload = f.tls.write_application.mock.calls.map(([bytes]) => new TextDecoder().decode(bytes)).join("");
    expect(payload.endsWith("x".repeat(262_144))).toBe(true);
  });

  it("requires authenticated TLS close_notify for close-delimited response completion", async () => {
    const clean = tcpFixture("HTTP/1.0 200 OK\r\n\r\n{}", { notify: true });
    expect(await (await createPinnedHttpConnector(clean)(pinnedRequest())).text()).toBe("{}");
    const truncated = tcpFixture("HTTP/1.0 200 OK\r\n\r\n{}");
    truncated.input()?.close();
    await expect(createPinnedHttpConnector(truncated)(pinnedRequest())).rejects.toMatchObject({ reason: "unreachable", requestStarted: true });
    expect(truncated.socket.close).toHaveBeenCalledTimes(1);
  });

  it.each(["open", "handshake", "application", "response"] as const)("aborts %s without waiting forever on native I/O or cleanup", async (stage) => {
    const controller = new AbortController();
    const never = new Promise<void>(() => {});
    const f = tcpFixture(stage === "response" ? "" : undefined, { opened: stage === "open" ? never : undefined,
      write: (bytes) => (stage === "handshake" && bytes[0] === 22 || stage === "application" && bytes[0] === 80) ? never : Promise.resolve() });
    f.socket.close.mockReturnValue(never);
    const running = createPinnedHttpConnector(f)(pinnedRequest({ signal: controller.signal }));
    await vi.waitFor(() => {
      if (stage === "response") expect(f.tls.write_application).toHaveBeenCalled();
      else if (stage === "application") expect(f.writes.some((bytes) => bytes[0] === 80)).toBe(true);
      else if (stage === "handshake") expect(f.writes).toHaveLength(1);
      else expect(f.openTcp).toHaveBeenCalled();
    });
    controller.abort();
    await expect(running).rejects.toMatchObject({ reason: "timeout", requestStarted: stage === "application" || stage === "response" });
    expect(f.socket.close).toHaveBeenCalledTimes(1);
    expect(f.tls.free).toHaveBeenCalledTimes(1);
  });

  it("does not allocate a TLS client or socket for an already aborted request", async () => {
    const controller = new AbortController(); controller.abort();
    const f = tcpFixture();
    await expect(createPinnedHttpConnector(f)(pinnedRequest({ signal: controller.signal }))).rejects.toMatchObject({ reason: "timeout", requestStarted: false });
    expect(f.openTcp).not.toHaveBeenCalled();
    expect(f.createTls).not.toHaveBeenCalled();
  });

  it.each(["open", "write", "read"] as const)("does not touch freed TLS when an interrupted %s later completes", async (stage) => {
    let finish: () => void = () => {};
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const controller = new AbortController();
    const f = tcpFixture(stage === "read" ? "" : undefined, {
      opened: stage === "open" ? pending : undefined,
      write: (bytes) => stage === "write" && bytes[0] === 80 ? pending : Promise.resolve(),
    });
    if (stage === "read") {
      const reader = f.socket.readable.getReader();
      vi.spyOn(reader, "read")
        .mockResolvedValueOnce({ done: false, value: Uint8Array.of(1) })
        .mockImplementation(() => pending.then(() => ({ done: false, value: textBytes("late ciphertext") })));
      vi.spyOn(f.socket.readable, "getReader").mockReturnValue(reader);
    }
    const running = createPinnedHttpConnector(f)(pinnedRequest({ signal: controller.signal }));
    await vi.waitFor(() => {
      if (stage === "open") expect(f.openTcp).toHaveBeenCalled();
      else expect(f.writes.some((bytes) => bytes[0] === 80)).toBe(true);
    });
    controller.abort();
    await expect(running).rejects.toMatchObject({ reason: "timeout", requestStarted: stage !== "open" });
    const calls = [f.tls.receive_tls.mock.calls.length, f.tls.take_tls.mock.calls.length, f.tls.read_application.mock.calls.length];
    finish();
    await pending;
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    expect([f.tls.receive_tls.mock.calls.length, f.tls.take_tls.mock.calls.length, f.tls.read_application.mock.calls.length]).toEqual(calls);
    expect(f.tls.free).toHaveBeenCalledTimes(1);
    expect(f.socket.close).toHaveBeenCalledTimes(1);
  });

  it("rejects excessive ciphertext before TLS parsing while retaining the started state", async () => {
    const f = tcpFixture("");
    f.input()?.enqueue(new Uint8Array(262_145));
    await expect(createPinnedHttpConnector(f)(pinnedRequest())).rejects.toMatchObject({ reason: "unreachable", requestStarted: true });
    expect(f.tls.receive_tls).toHaveBeenCalledTimes(1);
    expect(f.tls.free).toHaveBeenCalledTimes(1);
    expect(f.socket.close).toHaveBeenCalledTimes(1);
  });

  it("releases the TLS client if opening TCP fails before any application bytes", async () => {
    const f = tcpFixture();
    f.openTcp.mockImplementation(() => { throw new Error("fixture socket unavailable"); });
    await expect(createPinnedHttpConnector(f)(pinnedRequest())).rejects.toMatchObject({ reason: "unreachable", requestStarted: false });
    expect(f.tls.write_application).not.toHaveBeenCalled();
    expect(f.tls.free).toHaveBeenCalledTimes(1);
  });

  it("closes an opened socket and releases TLS if its writer cannot be acquired", async () => {
    const f = tcpFixture();
    const locked = f.socket.writable.getWriter();
    await expect(createPinnedHttpConnector(f)(pinnedRequest())).rejects.toMatchObject({ reason: "unreachable", requestStarted: false });
    expect(f.socket.close).toHaveBeenCalledTimes(1);
    expect(f.tls.free).toHaveBeenCalledTimes(1);
    expect(f.tls.write_application).not.toHaveBeenCalled();
    locked.releaseLock();
  });

  it("preserves known-unsent state through the outer transport's abort fence", async () => {
    const controller = new AbortController();
    const f = tcpFixture(undefined, { write: () => new Promise<void>(() => {}) });
    const transport = createPinnedWebhookTransport({ resolve: () => Promise.resolve(["8.8.8.8"]), connect: createPinnedHttpConnector(f) });
    const running = transport.post("https://receiver.example.com/events", { body: "{}", headers: {}, signal: controller.signal });
    await vi.waitFor(() => { expect(f.writes).toHaveLength(1); });
    controller.abort();
    await expect(running).rejects.toMatchObject({ reason: "timeout", requestStarted: false });
  });

  it.each([
    { address: "127.0.0.1" }, { address: "receiver.example.com" }, { family: 6 as const },
    { path: "/events\r\nX-Smuggle: yes" }, { body: "x".repeat(262_145) },
  ])("rejects invalid direct connector inputs before connecting", async (overrides) => {
    const f = tcpFixture();
    await expect(createPinnedHttpConnector(f)(pinnedRequest(overrides))).rejects.toBeDefined();
    expect(f.openTcp).not.toHaveBeenCalled();
    expect(f.createTls).not.toHaveBeenCalled();
  });
});

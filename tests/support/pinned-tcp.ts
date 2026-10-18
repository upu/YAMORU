import { vi } from "vitest";
import type { PinnedWebhookRequest } from "../../src/features/integration/notifications/webhook-transport";
import type { PinnedTcpSocket, TlsEngine } from "../../src/features/integration/notifications/http/pinned-connector";

export const textBytes = (value: string) => new TextEncoder().encode(value);
export function pinnedRequest(overrides: Partial<PinnedWebhookRequest> = {}): PinnedWebhookRequest {
  return { address: "8.8.8.8", family: 4, port: 443, expectedServerHostname: "receiver.example.com", path: "/events?test=1", body: '{"text":"あ"}',
    headers: { host: "wrong.example.com", "content-type": "application/json", "webhook-id": "fictional-event" }, signal: new AbortController().signal, ...overrides };
}

// These byte fixtures model the TLS boundary, not certificate validation.
export function tcpFixture(response = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}", options: { notify?: boolean; write?: (bytes: Uint8Array) => Promise<void>; opened?: Promise<unknown> } = {}) {
  let handshaking = true;
  let closed = false;
  let pending = Uint8Array.of(22, 1);
  const plaintext: Uint8Array[] = [];
  let input: ReadableStreamDefaultController<Uint8Array> | undefined;
  const tls = {
    handshaking: vi.fn(() => handshaking),
    peer_closed: vi.fn(() => closed),
    take_tls: vi.fn(() => { const bytes = pending; pending = new Uint8Array(); return bytes; }),
    receive_tls: vi.fn((bytes: Uint8Array) => {
      if (handshaking) { if (bytes[0] !== 1) throw new Error("invalid certificate fixture"); handshaking = false; return; }
      if (bytes.length === 1 && bytes[0] === 0) closed = true;
      else plaintext.push(bytes);
    }),
    write_application: vi.fn((bytes: Uint8Array) => { if (handshaking) throw new Error("unauthenticated write"); pending = bytes.slice(); }),
    read_application: vi.fn(() => plaintext.shift() ?? new Uint8Array()),
    free: vi.fn(),
  } satisfies TlsEngine;
  const writes: Uint8Array[] = [];
  const socket = {
    readable: new ReadableStream<Uint8Array>({ start(controller) {
      input = controller;
      controller.enqueue(Uint8Array.of(1));
      if (response) controller.enqueue(textBytes(response));
      if (options.notify) controller.enqueue(Uint8Array.of(0));
    } }),
    writable: new WritableStream<Uint8Array>({ write(bytes) { writes.push(bytes.slice()); return options.write?.(bytes); } }),
    opened: options.opened ?? Promise.resolve({ remoteAddress: "8.8.8.8:443" }),
    closed: Promise.resolve(),
    close: vi.fn(() => Promise.resolve()),
  } satisfies PinnedTcpSocket;
  const openTcp = vi.fn(() => socket);
  const createTls = vi.fn(() => tls);
  return { socket, tls, writes, openTcp, createTls, input: () => input };
}

import { connect } from "cloudflare:sockets";
import tlsModule from "../generated/tls_bg.wasm";
import { initSync, TlsClient } from "../generated/tls.js";

initSync({ module: tlsModule });

const CASES = {
  valid: { address: "104.154.89.105", hostname: "badssl.com" },
  wrong: { address: "104.154.89.105", hostname: "wrong.host.badssl.com" },
  expired: { address: "104.154.89.105", hostname: "expired.badssl.com" },
  selfsigned: { address: "104.154.89.105", hostname: "self-signed.badssl.com" },
  close_notify: { address: "104.154.89.105", hostname: "badssl.com" },
};

const worker = {
  async fetch(request) {
    const testCase = new URL(request.url).searchParams.get("case") ?? "valid";
    if (!Object.hasOwn(CASES, testCase)) return new Response("unknown case", { status: 400 });
    const { address, hostname } = CASES[testCase];
    const socket = connect({ hostname: address, port: 443 }, { secureTransport: "off" });
    socket.closed.catch(() => {});
    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();
    const tls = new TlsClient(hostname);
    let timer;
    let handshakeComplete = false;
    let applicationBytes = 0;
    let receivedTlsBytes = 0;
    let handshakeSteps = 0;
    let timedOut = false;
    let running;
    const flushTls = async () => {
      const bytes = tls.take_tls();
      if (bytes.length) await writer.write(bytes);
    };
    const receive = async () => {
      const { value, done } = await reader.read();
      if (timedOut) throw new Error("probe_timeout");
      if (done) throw new Error("unexpected_tls_eof");
      receivedTlsBytes += value.length;
      if (receivedTlsBytes > 262_144) throw new Error("tls_input_limit");
      tls.receive_tls(value);
    };
    try {
      const operation = async () => {
        await socket.opened;
        while (tls.handshaking()) {
          if (++handshakeSteps > 64) throw new Error("handshake_step_limit");
          await flushTls();
          await receive();
        }
        handshakeComplete = true;
        await flushTls();
        const head = new TextEncoder().encode(`HEAD / HTTP/1.1\r\nHost: ${hostname}\r\nConnection: close\r\n\r\n`);
        tls.write_application(head);
        applicationBytes = head.length;
        await flushTls();
        let firstStatusLine;
        for (let reads = 0; reads < 64; reads++) {
          const plaintext = tls.read_application();
          if (plaintext.length && firstStatusLine === undefined) firstStatusLine = new TextDecoder().decode(plaintext).split("\r\n")[0];
          if (firstStatusLine && (testCase !== "close_notify" || tls.peer_closed())) return firstStatusLine;
          await receive();
          await flushTls();
        }
        throw new Error("response_step_limit");
      };
      running = operation();
      const statusLine = await Promise.race([
        running,
        new Promise((_, reject) => { timer = setTimeout(() => {
          timedOut = true;
          socket.close().catch(() => {});
          reject(new Error("probe_timeout"));
        }, 10_000); }),
      ]);
      return Response.json({ ok: true, testCase, address, hostname, handshakeComplete, applicationBytes, receivedTlsBytes, statusLine, peerClosed: tls.peer_closed() });
    } catch (error) {
      return Response.json({ ok: false, testCase, address, hostname, handshakeComplete, applicationBytes, receivedTlsBytes, error: String(error).slice(0, 500) });
    } finally {
      clearTimeout(timer);
      await socket.close().catch(() => {});
      await running?.catch(() => {});
      tls.free();
    }
  },
};
export default worker;

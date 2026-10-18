import { WebhookEndpointError, type PinnedWebhookRequest } from "../webhook-transport";
import { closeOwned, IoScope } from "./lifecycle";
import { serializePinnedPost } from "./request";
import { readPinnedHttpResponse } from "./response";
import { TlsChannel } from "./tls-channel";
import type { OwnedConnection, PinnedTcpSocket, TlsEngine } from "./socket";
export type { PinnedTcpSocket, TlsEngine } from "./socket";

type Dependencies = { openTcp: (address: { hostname: string; port: 443 }) => PinnedTcpSocket; createTls: (hostname: string) => TlsEngine };
function failureCategory(error: unknown) {
  if (error instanceof WebhookEndpointError) return error.reason;
  if (error instanceof Error) {
    if (error.message.includes("proxy request failed, cannot connect to the specified address")) return "tcp_address_disallowed";
    if (error.message.includes("TCP Loop detected")) return "tcp_loop";
  }
  return "unclassified";
}
export function createPinnedHttpConnector(deps: Dependencies) {
  return async (request: PinnedWebhookRequest): Promise<Response> => {
    const scope = new IoScope(AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]), () => { request.reportProgress?.("request_started"); });
    const owned: OwnedConnection = {};
    let phase: "input" | "tls_initialization" | "tcp_connect" | "tls_handshake" | "http_send" | "http_response" = "input";
    try {
      scope.check();
      request.reportProgress?.("connecting");
      const post = serializePinnedPost(request);
      phase = "tls_initialization";
      const tls = deps.createTls(request.expectedServerHostname); owned.tls = tls;
      phase = "tcp_connect";
      const socket = deps.openTcp({ hostname: request.address, port: 443 }); owned.socket = socket;
      void socket.closed.catch(() => {});
      const reader = socket.readable.getReader(); owned.reader = reader;
      const writer = socket.writable.getWriter(); owned.writer = writer;
      const channel = new TlsChannel(tls, reader, writer, scope);
      await channel.handshake(socket.opened, () => { phase = "tls_handshake"; });
      phase = "http_send";
      await channel.send(post);
      phase = "http_response";
      return await readPinnedHttpResponse(() => channel.read(), { headOnly: request.readResponseBody === false });
    } catch (error) {
      console.warn({ event: "mcp_event_transport_failure", phase, category: failureCategory(error), request_started: scope.requestStarted });
      if (error instanceof WebhookEndpointError) throw error;
      throw new WebhookEndpointError("unreachable", scope.requestStarted);
    } finally { scope.dispose(); closeOwned(owned); }
  };
}

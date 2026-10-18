import { WebhookEndpointError, type PinnedWebhookRequest } from "../webhook-transport";
import { closeOwned, IoScope } from "./lifecycle";
import { serializePinnedPost } from "./request";
import { readPinnedHttpResponse } from "./response";
import { TlsChannel } from "./tls-channel";
import type { OwnedConnection, PinnedTcpSocket, TlsEngine } from "./socket";
export type { PinnedTcpSocket, TlsEngine } from "./socket";

type Dependencies = { openTcp: (address: { hostname: string; port: 443 }) => PinnedTcpSocket; createTls: (hostname: string) => TlsEngine };
export function createPinnedHttpConnector(deps: Dependencies) {
  return async (request: PinnedWebhookRequest): Promise<Response> => {
    const scope = new IoScope(AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]), () => { request.reportProgress?.("request_started"); });
    const owned: OwnedConnection = {};
    try {
      scope.check();
      request.reportProgress?.("connecting");
      const post = serializePinnedPost(request);
      const tls = deps.createTls(request.expectedServerHostname); owned.tls = tls;
      const socket = deps.openTcp({ hostname: request.address, port: 443 }); owned.socket = socket;
      void socket.closed.catch(() => {});
      const reader = socket.readable.getReader(); owned.reader = reader;
      const writer = socket.writable.getWriter(); owned.writer = writer;
      const channel = new TlsChannel(tls, reader, writer, scope);
      await channel.handshake(socket.opened);
      await channel.send(post);
      return await readPinnedHttpResponse(() => channel.read(), { headOnly: request.readResponseBody === false });
    } catch (error) {
      if (error instanceof WebhookEndpointError) throw error;
      throw new WebhookEndpointError("unreachable", scope.requestStarted);
    } finally { scope.dispose(); closeOwned(owned); }
  };
}

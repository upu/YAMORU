import { connect } from "cloudflare:sockets";
import tlsModule from "../../../../packages/pinned-tls/generated/tls_bg.wasm";
import { initSync, TlsClient } from "../../../../packages/pinned-tls/generated/tls.js";
import { createPinnedWebhookTransport } from "./webhook-transport.ts";
import { createPublicDnsResolver } from "./http/dns-resolver.ts";
import { createPinnedHttpConnector } from "./http/pinned-connector.ts";

initSync({ module: tlsModule });

export function createWorkerNotificationTransport() {
  return createPinnedWebhookTransport({ resolve: createPublicDnsResolver(), connect: createPinnedHttpConnector({
    openTcp: (address) => connect(address, { secureTransport: "off", allowHalfOpen: false }),
    createTls: (hostname) => new TlsClient(hostname),
  }) });
}

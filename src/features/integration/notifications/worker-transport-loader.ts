import type { PinnedWebhookTransport } from "./webhook-transport";

export function createLazyWorkerNotificationTransport(): PinnedWebhookTransport {
  return {
    async post(value, input) {
      // Disabled providers and ordinary page requests must not instantiate the TLS engine.
      const { createWorkerNotificationTransport } = await import("./worker-transport.mjs");
      return createWorkerNotificationTransport().post(value, input);
    },
  };
}

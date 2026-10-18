import type { McpDependencies } from "../mcp/http";
import type { NotificationEventProvider } from "./event-scheduler";
import type { PinnedWebhookTransport } from "./webhook-transport";

export const NOTIFICATION_EVENT_PROVIDER = "rustls-pinned-v1";
const EVENTS = Symbol.for("yamoru.notifications.verified-transport");
type ProviderEnvironment = { AUTH_SECRET: string; YAMORU_EVENTS_PROVIDER?: string };
type RuntimeSlot = { [EVENTS]?: NonNullable<McpDependencies["events"]> };
type TransportFactory = () => PinnedWebhookTransport;

export function createNotificationEventProvider(environment: ProviderEnvironment, makeTransport: TransportFactory): NotificationEventProvider | undefined {
  if (environment.YAMORU_EVENTS_PROVIDER !== NOTIFICATION_EVENT_PROVIDER) return undefined;
  return { providerId: NOTIFICATION_EVENT_PROVIDER, secret: environment.AUTH_SECRET, transport: makeTransport() };
}

export function withWorkerEvents<T extends ProviderEnvironment>(environment: T, makeTransport: TransportFactory) {
  const provider = createNotificationEventProvider(environment, makeTransport);
  if (!provider) return environment;
  return { ...environment, [EVENTS]: { providerId: provider.providerId, transport: provider.transport } };
}

export function readWorkerEvents(environment: object) { return (environment as RuntimeSlot)[EVENTS]; }

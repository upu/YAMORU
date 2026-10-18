// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createNotificationEventProvider, readWorkerEvents, withWorkerEvents, NOTIFICATION_EVENT_PROVIDER } from "../src/features/integration/notifications/worker-events";

const env = { AUTH_SECRET: "fictional-worker-master-secret-at-least-32-bytes", DB: { fictional: true }, YAMORU_EVENTS_PROVIDER: undefined as string | undefined };
function factory() { return { post: vi.fn().mockResolvedValue(new Response("{}")) }; }

it.each([undefined, "", "true", "other"])("keeps an unconfigured %s provider off without building a transport", (flag) => {
  const make = vi.fn(factory);
  const source = { ...env, YAMORU_EVENTS_PROVIDER: flag };
  expect(createNotificationEventProvider(source, make)).toBeUndefined();
  expect(withWorkerEvents(source, make)).toBe(source);
  expect(readWorkerEvents(source)).toBeUndefined();
  expect(make).not.toHaveBeenCalled();
});

it("passes the same versioned provider and secret to the scheduled sender", () => {
  const transport = factory();
  const provider = createNotificationEventProvider({ ...env, YAMORU_EVENTS_PROVIDER: NOTIFICATION_EVENT_PROVIDER }, () => transport);
  expect(provider).toEqual({ providerId: NOTIFICATION_EVENT_PROVIDER, secret: env.AUTH_SECRET, transport });
});

it("forwards transport through a request-local symbol while preserving existing environment bindings", () => {
  const transport = factory();
  const source = { ...env, YAMORU_EVENTS_PROVIDER: NOTIFICATION_EVENT_PROVIDER };
  const forwarded = withWorkerEvents(source, () => transport);
  expect(forwarded.DB).toBe(source.DB);
  expect(forwarded.AUTH_SECRET).toBe(source.AUTH_SECRET);
  expect(readWorkerEvents(forwarded)).toEqual({ providerId: NOTIFICATION_EVENT_PROVIDER, transport });
  expect(readWorkerEvents(source)).toBeUndefined();
  expect(Object.keys(forwarded)).toEqual(Object.keys(source));
});

it("does not retain another request's transport in global state", () => {
  const first = factory(), second = factory();
  const source = { ...env, YAMORU_EVENTS_PROVIDER: NOTIFICATION_EVENT_PROVIDER };
  const a = withWorkerEvents(source, () => first);
  const b = withWorkerEvents(source, () => second);
  expect(readWorkerEvents(a)?.transport).toBe(first);
  expect(readWorkerEvents(b)?.transport).toBe(second);
  expect(readWorkerEvents(source)).toBeUndefined();
});

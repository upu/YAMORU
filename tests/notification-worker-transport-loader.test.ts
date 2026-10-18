// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createLazyWorkerNotificationTransport } from "../src/features/integration/notifications/worker-transport-loader";
import { createNotificationEventProvider, NOTIFICATION_EVENT_PROVIDER } from "../src/features/integration/notifications/worker-events";

const native = vi.hoisted(() => ({ loads: 0, make: vi.fn(), post: vi.fn() }));
vi.mock("../src/features/integration/notifications/worker-transport.mjs", () => {
  native.loads++;
  native.make.mockReturnValue({ post: native.post });
  return { createWorkerNotificationTransport: native.make };
});

it("does not load native TLS for disabled providers or until an enabled provider actually posts", async () => {
  const env = { AUTH_SECRET: "fictional-worker-secret" };
  expect(createNotificationEventProvider(env, createLazyWorkerNotificationTransport)).toBeUndefined();
  expect(native.loads).toBe(0);
  const provider = createNotificationEventProvider({ ...env, YAMORU_EVENTS_PROVIDER: NOTIFICATION_EVENT_PROVIDER }, createLazyWorkerNotificationTransport);
  expect(provider).toBeDefined();
  expect(native.loads).toBe(0);
  const response = new Response(null, { status: 202 });
  native.post.mockResolvedValue(response);
  const input = { body: "{}", headers: { "webhook-id": "fictional-event" }, signal: new AbortController().signal, readResponseBody: false };
  expect(await provider?.transport.post("https://receiver.example.com/events", input)).toBe(response);
  expect(native.loads).toBe(1);
  expect(native.post).toHaveBeenCalledExactlyOnceWith("https://receiver.example.com/events", input);
  expect(native.make).toHaveBeenCalledTimes(1);
});

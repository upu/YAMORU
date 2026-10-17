import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { applyAllMigrations } from "./test-support/migrations";
import { resetNotificationFixtures, notificationPrincipal as principal } from "./test-support/notifications";
import { createEventSubscriptionService } from "../../features/integration/notifications/event-subscriptions";
const db = env.DB;
const url = "https://receiver.example.com/events";
const input = { name: "attention.ready", delivery: { mode: "webhook", url, secret: `whsec_${btoa("x".repeat(32))}` } };
const api = () => createEventSubscriptionService({ db, authorize: async () => principal, secret: "fictional-master-secret-at-least-32-bytes", providerId: "test",
  transport: { post: vi.fn(async (_url: string, request: { body: string }) => Response.json({ challenge: JSON.parse(request.body).challenge })) } });
beforeAll(() => applyAllMigrations(db));
beforeEach(() => resetNotificationFixtures(db));
async function lifetime() { return db.prepare("SELECT * FROM notification_event_subscriptions").first<Record<string, unknown>>(); }
it("有効な購読の鍵更新は世代を保ち、解除と再購読で古い通知と区別する", async () => {
  const service = api();
  await service.subscribe(input);
  const first = await lifetime();
  expect(first?.lifecycle).toMatch(/^[0-9a-f]{32}$/);
  await service.subscribe({ ...input, delivery: { ...input.delivery, secret: `whsec_${btoa("y".repeat(32))}` } });
  expect((await lifetime())?.lifecycle).toBe(first?.lifecycle);
  await service.unsubscribe({ name: input.name, delivery: { mode: "webhook", url } });
  await service.subscribe(input);
  expect((await lifetime())?.lifecycle).not.toBe(first?.lifecycle);
});
it("期限切れを未清掃のまま再購読しても、削除・再作成しても世代を再利用しない", async () => {
  const service = api();
  await service.subscribe(input);
  const first = await lifetime();
  await db.prepare("UPDATE notification_event_subscriptions SET expires_at='2000-01-01T00:00:00.000Z',verified_at='1999-01-01T00:00:00.000Z'").run();
  await service.subscribe(input);
  const second = await lifetime();
  expect(second?.lifecycle).not.toBe(first?.lifecycle);
  await db.prepare("DELETE FROM notification_event_subscriptions").run();
  await service.subscribe(input);
  expect((await lifetime())?.lifecycle).not.toBe(second?.lifecycle);
});

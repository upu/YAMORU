import { createHmac } from "node:crypto";
import { expect, it, vi } from "vitest";
import { encryptWebhookDestination } from "../src/features/integration/notifications/event-crypto";
import { WebhookEndpointError, type PinnedWebhookTransport } from "../src/features/integration/notifications/webhook-transport";
import { sendEventRecipient } from "../src/features/integration/notifications/event-delivery";
import type { IntegrationPrincipal } from "../src/features/integration/principal";
const principal: IntegrationPrincipal = { householdId: "household-a", userId: "user-a", connectionId: "connection-a", clientId: "https://client.example.test", scopes: ["household.read", "events.subscribe"] };
const master = "fictional-event-encryption-key-with-at-least-32-characters";
const secret = `whsec_${Buffer.alloc(32, 0x5a).toString("base64")}`;
const url = "https://receiver.example.com/events?token=fictional-token";
const now = new Date("2026-10-18T00:00:00.000Z");
const body = '{ "eventId": "evt-1", "name": "attention.ready", "data": {"delivery_id":"delivery-1"} }';
async function fixture(response = new Response(null, { status: 202 }), previous?: { secret: string; expiresAt: string }) {
  const attempt = { subscriptionId: "sub-1", token: "attempt-1", eventId: "evt-1", body, providerId: "test",
    encryptedDestination: await encryptWebhookDestination(master, principal, "sub-1", { url, secret, ...(previous ? { previous } : {}) }) };
  const post = vi.fn<PinnedWebhookTransport["post"]>().mockResolvedValue(response);
  const deps = { principal, secret: master, providerId: "test", transport: { post }, now: () => now };
  return { attempt, post, deps };
}
it("同じID・本文を一度だけ送り、再試行でも署名時刻だけを更新する", async () => {
  const { attempt, post, deps } = await fixture();
  expect(await sendEventRecipient(deps, attempt)).toEqual({ kind: "accepted" });
  expect(post).toHaveBeenCalledTimes(1);
  const sent = post.mock.calls[0];
  expect(sent[0]).toBe(url);
  expect(sent[1].body).toBe(body);
  const timestamp = String(now.getTime() / 1000);
  expect(sent[1].headers).toMatchObject({ "webhook-id": "evt-1", "webhook-timestamp": timestamp, "X-MCP-Subscription-Id": "sub-1",
    "webhook-signature": `v1,${createHmac("sha256", Buffer.alloc(32, 0x5a)).update(`evt-1.${timestamp}.${body}`).digest("base64")}` });
  await sendEventRecipient({ ...deps, now: () => new Date(now.getTime() + 60_000) }, attempt);
  expect(post.mock.calls[1][1].body).toBe(body);
  expect(post.mock.calls[1][1].headers["webhook-id"]).toBe("evt-1");
  expect(post.mock.calls[1][1].headers["webhook-timestamp"]).not.toBe(timestamp);
});
it.each([200, 202, 204, 299])("%iは受領として扱い、既読や処理完了を作らない", async (status) => {
  const { attempt, deps } = await fixture(new Response(null, { status }));
  expect(await sendEventRecipient(deps, attempt)).toEqual({ kind: "accepted" });
});
it.each([408, 425, 429, 500, 503])("%iは既知の一時失敗とし、この関数内で再送しない", async (status) => {
  const { attempt, deps, post } = await fixture(new Response(null, { status }));
  expect(await sendEventRecipient(deps, attempt)).toEqual({ kind: "retry", reason: `http_${String(status)}` });
  expect(post).toHaveBeenCalledTimes(1);
});
it.each([301, 400, 401, 403, 404, 410, 413])("%iには自動再送を要求しない", async (status) => {
  const { attempt, deps } = await fixture(new Response(null, { status }));
  expect(await sendEventRecipient(deps, attempt)).toEqual({ kind: "failed", reason: `http_${String(status)}` });
});
it.each([false, true])("開始状態%sの通信失敗を既知の未送信と結果不明に分ける", async (started) => {
  const { attempt, deps, post } = await fixture();
  post.mockRejectedValue(new WebhookEndpointError("unreachable", started));
  expect(await sendEventRecipient(deps, attempt)).toEqual({ kind: started ? "unknown" : "retry", reason: "unreachable" });
  expect(post).toHaveBeenCalledTimes(1);
});
it("未知の例外を結果不明とし、URL・署名鍵・例外本文を返さない", async () => {
  const { attempt, deps, post } = await fixture();
  post.mockRejectedValue(new Error(`${url} ${secret}`));
  expect(await sendEventRecipient(deps, attempt)).toEqual({ kind: "unknown", reason: "transport_error" });
});
it.each(["blocked_url", "blocked_address", "redirect_not_allowed", "payload_too_large"] as const)("%sを再送可能な通信障害へ置き換えない", async (reason) => {
  const { attempt, deps, post } = await fixture();
  post.mockRejectedValue(new WebhookEndpointError(reason, reason === "redirect_not_allowed"));
  expect(await sendEventRecipient(deps, attempt)).toEqual({ kind: "failed", reason });
});
it("HTTP結果を得ていない応答は不明とし、必要scopeがない主体では送信しない", async () => {
  const { attempt, deps, post } = await fixture(Response.error());
  expect(await sendEventRecipient(deps, attempt)).toEqual({ kind: "unknown", reason: "response_unavailable" });
  post.mockClear();
  expect(await sendEventRecipient({ ...deps, principal: { ...principal, scopes: ["household.read"] } }, attempt)).toEqual({ kind: "failed", reason: "access_unavailable" });
  expect(post).not.toHaveBeenCalled();
});
it("別provider・暗号化鍵・所有者では送り出さない", async () => {
  const { attempt, deps, post } = await fixture();
  expect(await sendEventRecipient({ ...deps, providerId: "other" }, attempt)).toMatchObject({ kind: "failed" });
  expect(await sendEventRecipient({ ...deps, secret: `${master}-rotated` }, attempt)).toMatchObject({ kind: "failed", reason: "key_unavailable" });
  expect(await sendEventRecipient({ ...deps, principal: { ...principal, householdId: "household-b" } }, attempt)).toMatchObject({ kind: "failed", reason: "key_unavailable" });
  expect(post).not.toHaveBeenCalled();
});
it("送信前の中断は未送信として返し、受領後の本文の終了待ちでは止まらない", async () => {
  const { attempt, deps, post } = await fixture(new Response(new ReadableStream({ cancel: () => new Promise<void>(() => {}) }), { status: 202 }));
  const controller = new AbortController(); controller.abort();
  expect(await sendEventRecipient({ ...deps, signal: controller.signal }, attempt)).toEqual({ kind: "retry", reason: "timeout" });
  expect(post).not.toHaveBeenCalled();
  expect(await sendEventRecipient(deps, attempt)).toEqual({ kind: "accepted" });
});
it("期限内だけ旧鍵との二重署名を送り、移行期間を過ぎたら現行鍵だけにする", async () => {
  const previous = { secret: `whsec_${Buffer.alloc(32, 0x59).toString("base64")}`, expiresAt: new Date(now.getTime() + 300_000).toISOString() };
  const { attempt, deps, post } = await fixture(undefined, previous);
  await sendEventRecipient(deps, attempt);
  expect(post.mock.calls[0][1].headers["webhook-signature"].split(" ")).toHaveLength(2);
  await sendEventRecipient({ ...deps, now: () => new Date(now.getTime() + 301_000) }, attempt);
  expect(post.mock.calls[1][1].headers["webhook-signature"].split(" ")).toHaveLength(1);
});

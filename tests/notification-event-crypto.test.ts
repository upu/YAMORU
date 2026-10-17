import { createHmac } from "node:crypto";
import { expect, it } from "vitest";
import { encryptWebhookDestination, decryptWebhookDestination, standardWebhookHeaders, decodeWebhookSecret, sameChallenge } from "../src/features/integration/notifications/event-crypto";
const master = "fictional-event-encryption-key-with-at-least-32-characters";
const secret = `whsec_${Buffer.alloc(32, 0x5a).toString("base64")}`;
const owner = { householdId: "household-a", userId: "user-a", connectionId: "connection-a", clientId: "https://client.example.test/oauth/client.json" };
const destination = { url: "https://receiver.example.test/events/fictional-callback", secret };
it("購読先と署名keyを暗号化し、nonceを再利用しない", async () => {
  const first = await encryptWebhookDestination(master, owner, "sub-1", destination);
  const second = await encryptWebhookDestination(master, owner, "sub-1", destination);
  expect(first).not.toContain(secret);
  expect(first).not.toContain(destination.url);
  expect(first).not.toBe(second);
  expect(await decryptWebhookDestination(master, owner, "sub-1", first)).toEqual(destination);
  const withOtherMetadata = { ...owner, scopes: ["household.read", "events.subscribe"] };
  expect(await decryptWebhookDestination(master, withOtherMetadata, "sub-1", first)).toEqual(destination);
});
it("別の家庭・本人・接続・購読へ暗号文を移せず、改変とkey変更も拒否する", async () => {
  const cipher = await encryptWebhookDestination(master, owner, "sub-1", destination);
  for (const changes of [{ householdId: "household-b" }, { userId: "user-b" }, { connectionId: "connection-b" }, { clientId: "https://other.example.test" }]) {
    await expect(decryptWebhookDestination(master, { ...owner, ...changes }, "sub-1", cipher)).rejects.toThrow();
  }
  await expect(decryptWebhookDestination(master, owner, "sub-2", cipher)).rejects.toThrow();
  await expect(decryptWebhookDestination(`${master}-rotated`, owner, "sub-1", cipher)).rejects.toThrow();
  await expect(decryptWebhookDestination(master, owner, "sub-1", `${cipher.slice(0, -2)}AA`)).rejects.toThrow();
});
it("Standard Webhooksのexact UTF-8 bytesをHMACで署名し、再試行では署名時刻を更新する", async () => {
  const body = JSON.stringify({ eventId: "event-1", data: { candidate_ids: ["candidate-1"], label: "架空の検証" } });
  const now = new Date("2026-10-18T00:00:00Z");
  const headers = await standardWebhookHeaders(secret, "sub-1", "event-1", body, now);
  const expected = createHmac("sha256", Buffer.alloc(32, 0x5a)).update(`event-1.${String(Math.floor(now.getTime() / 1000))}.${body}`, "utf8").digest("base64");
  expect(headers).toMatchObject({ "webhook-id": "event-1", "webhook-timestamp": String(Math.floor(now.getTime() / 1000)), "webhook-signature": `v1,${expected}`, "X-MCP-Subscription-Id": "sub-1" });
  const retry = await standardWebhookHeaders(secret, "sub-1", "event-1", body, new Date(now.getTime() + 1000));
  expect(retry["webhook-id"]).toBe(headers["webhook-id"]);
  expect(retry["webhook-signature"]).not.toBe(headers["webhook-signature"]);
});
it("24〜64 bytesのwhsecだけを採用し、challengeを正確に照合する", async () => {
  for (const size of [24, 32, 64]) expect(decodeWebhookSecret(`whsec_${Buffer.alloc(size).toString("base64")}`)).toHaveLength(size);
  for (const value of ["plain-secret", "whsec_!invalid", `whsec_${Buffer.alloc(23).toString("base64")}`, `whsec_${Buffer.alloc(65).toString("base64")}`]) expect(() => decodeWebhookSecret(value)).toThrow();
  expect(await sameChallenge("random-challenge", "random-challenge")).toBe(true);
  expect(await sameChallenge("random-challenge", "different-value")).toBe(false);
});
it("鍵の移行期間だけ二つの署名を付け、期限後は現行鍵だけにする", async () => {
  const now = new Date("2026-10-18T00:00:00Z");
  const previous = { secret: `whsec_${Buffer.alloc(32, 1).toString("base64")}`, expiresAt: new Date(now.getTime() + 300_000).toISOString() };
  const rotating = await standardWebhookHeaders(secret, "sub-1", "event-1", "{}", now, previous);
  expect(rotating["webhook-signature"].split(" ")).toHaveLength(2);
  const expired = await standardWebhookHeaders(secret, "sub-1", "event-1", "{}", new Date(now.getTime() + 300_000), previous);
  expect(expired["webhook-signature"].split(" ")).toHaveLength(1);
});

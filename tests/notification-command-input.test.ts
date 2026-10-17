import { expect, it } from "vitest";
import { notificationSnoozeHandler } from "../src/features/integration/commands/notification-snooze";

const context = { db: {} as D1Database, householdId: "household-a", userId: "user-a", now: new Date("2026-10-17T00:00:00Z") };
const payload = { candidate_id: "candidate-a", candidate_revision: "revision", until: "2026-10-18T00:00:00Z" };

it.each(["yes", 1, null, {}])("不正なmuted値(%j)を日時のエラーとして返さない", (muted) => {
  expect(() => notificationSnoozeHandler.normalize(context, { payload: { ...payload, muted }, target: undefined }))
    .toThrow(expect.objectContaining({ code: "invalid_input", fieldErrors: { muted: "boolean_required" } }));
});

it("mutedが正しい場合は不正な日時の項目を返す", () => {
  expect(() => notificationSnoozeHandler.normalize(context, { payload: { ...payload, muted: true, until: "tomorrow" }, target: undefined }))
    .toThrow(expect.objectContaining({ code: "invalid_input", fieldErrors: { until: "future_instant_required" } }));
});

import { expect, it } from "vitest";
import { projectAttention } from "../src/features/integration/attention/projection";

const source = {
  kind: "todo_occurrence" as const, id: "todo-a", name: "フィルター", status: "pending",
  assignee_user_id: "user-a", deadline_kind: "maintenance", scheduled_for: "2026-10-01T15:00:00.000Z",
  due_at: "2026-10-11T15:00:00.000Z", must_complete_by: "2026-10-17", stock_status: null,
};

it("必達日と目安を併記し、東京の当日と超過を区別する", () => {
  const today = projectAttention(source, new Date("2026-10-17T00:00:00Z"));
  expect(today).toMatchObject({ reason_codes: ["hard_deadline_today", "maintenance_overdue"], priority: "high", priority_rank: 1,
    dates: { must_complete_by: "2026-10-17", due_on: null, recommended_window: { state: "past-window" } }, assignee_user_id: "user-a" });
  expect(projectAttention(source, new Date("2026-10-17T15:00:00Z"))?.reason_codes[0]).toBe("hard_deadline_overdue");
});

it("目安の開始前、期間内、そろそろ、超過を共通projectionで判断する", () => {
  const item = { ...source, must_complete_by: null };
  expect(projectAttention(item, new Date("2026-10-01T14:59:59Z"))).toBeNull();
  expect(projectAttention(item, new Date("2026-10-01T15:00:00Z"))?.reason_codes).toEqual(["maintenance_window"]);
  expect(projectAttention(item, new Date("2026-10-09T15:00:00Z"))?.reason_codes).toEqual(["maintenance_soon"]);
  expect(projectAttention(item, new Date("2026-10-12T15:00:00Z"))?.reason_codes).toEqual(["maintenance_overdue"]);
});

it("現在期限だけで判定し、完了・取消・アーカイブ状態と日付未定は除外する", () => {
  for (const status of ["completed", "skipped", "cancelled", "archived"]) {
    expect(projectAttention({ ...source, status }, new Date("2026-10-18T00:00:00Z"))).toBeNull();
  }
  const item = { ...source, deadline_kind: "strict", must_complete_by: null, due_at: "2026-10-20T15:00:00Z" };
  expect(projectAttention(item, new Date("2026-10-18T00:00:00Z"))).toBeNull();
  expect(projectAttention({ ...item, due_at: null, scheduled_for: null }, new Date("2026-10-18T00:00:00Z"))).toBeNull();
});

it("在庫なしと少ないを区別し、回復後は除外する", () => {
  const item = { ...source, kind: "consumable" as const, stock_status: "out" };
  expect(projectAttention(item, new Date("2026-10-17T00:00:00Z"))).toMatchObject({ reason_codes: ["stock_out"], priority_rank: 3, occurrence_id: null, dates: null });
  expect(projectAttention({ ...item, stock_status: "low" }, new Date("2026-10-17T00:00:00Z"))?.priority_rank).toBe(7);
  expect(projectAttention({ ...item, stock_status: "available" }, new Date("2026-10-17T00:00:00Z"))).toBeNull();
});

it("本来の予定日と延期後の現在期限を別に返す", () => {
  const item = { ...source, deadline_kind: "strict", must_complete_by: null, due_at: "2026-10-16T15:00:00Z" };
  expect(projectAttention(item, new Date("2026-10-17T00:00:00Z"))).toMatchObject({ reason_codes: ["scheduled_due"], priority_rank: 2,
    dates: { scheduled_on: "2026-10-02", due_on: "2026-10-17", recommended_window: null } });
});

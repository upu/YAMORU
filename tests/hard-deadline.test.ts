import { describe, expect, it } from "vitest";
import { buildPendingTodoEntries } from "../src/app/pending-todo";
import type { PendingOccurrenceRow } from "../src/lib/d1/home";

function row(id: string, deadline: string | null): PendingOccurrenceRow {
  return {
    id, must_complete_by: deadline, assignee_user_id: null,
    scheduled_for: "2026-10-20T15:00:00.000Z", due_at: "2026-11-01T15:00:00.000Z",
    task_rules: { title: id, deadline_kind: "maintenance", recurrence_basis: "completion", managed_items: null },
  };
}

describe("必達日と目安の独立した表示", () => {
  it("推奨期間超過なら、必達日が今日でも既存の警告を隠さない", () => {
    const late = { ...row("late", "2026-10-17"), due_at: "2026-10-15T15:00:00.000Z", scheduled_for: "2026-10-01T15:00:00.000Z" };
    const [entry] = buildPendingTodoEntries([late], "2026-10-17T00:00:00.000Z");
    expect(entry.category).toBe("reminder");
    expect(entry.item.tone).toBe("caution");
    expect(entry.item.badge).toBe("推奨期間超過");
    expect(entry.item.meta).toContain("必達日: 10月17日（今日）");
  });
  it("必達日超過を優先しても、元の推奨期間超過をカードと一覧用データに残す", () => {
    const late = { ...row("late", "2026-10-16"), due_at: "2026-10-15T15:00:00.000Z", scheduled_for: "2026-10-01T15:00:00.000Z" };
    const [entry] = buildPendingTodoEntries([late], "2026-10-17T00:00:00.000Z");
    expect(entry.category).toBe("overdue");
    expect(entry.item.badge).toBe("必達日超過");
    expect(entry.item.scheduleState).toBe("推奨期間超過");
    expect(entry.item.meta).toContain("推奨期間超過");
  });
  it("予定が期限切れなら、必達日が今日でも期限切れを隠さない", () => {
    const strict = { ...row("late", "2026-10-17"),
      scheduled_for: "2026-10-15T15:00:00.000Z", due_at: "2026-10-15T15:00:00.000Z",
      task_rules: { ...row("late", null).task_rules, recurrence_basis: "once", deadline_kind: "strict" } };
    const [entry] = buildPendingTodoEntries([strict], "2026-10-17T00:00:00.000Z");
    expect(entry.category).toBe("overdue");
    expect(entry.item.tone).toBe("urgent");
    expect(entry.item.meta).toContain("必達日: 10月17日（今日）");
  });
  it("東京の暦日で当日と超過を分け、推奨期間前でも必達日を表示する", () => {
    const [today] = buildPendingTodoEntries([row("a", "2026-10-17")], "2026-10-16T15:00:00.000Z");
    expect(today.category).toBe("today");
    expect(today.item.badge).toBe("今日が必達日");
    expect(today.item.listSchedule).toMatchObject({ kind: "range" });
    const [overdue] = buildPendingTodoEntries([row("a", "2026-10-17")], "2026-10-17T15:00:00.000Z");
    expect(overdue.category).toBe("overdue");
    expect(overdue.item.badge).toBe("必達日超過");
  });
  it("未設定の既存Todoを変えず、超過した必達日を最優先する", () => {
    const entries = buildPendingTodoEntries([row("unset", null), row("deadline", "2026-10-16")], "2026-10-17T00:00:00.000Z");
    expect(entries[0].item.id).toBe("deadline");
    expect(entries[1].category).toBe("before-window");
  });
  it("予定未定でも必達日が7日以内ならホームに案内し、未設定は従来の未定扱い", () => {
    const undated = { ...row("a", "2026-10-24"), due_at: null, scheduled_for: null,
      task_rules: { ...row("a", null).task_rules, recurrence_basis: "manual", deadline_kind: "strict" } };
    expect(buildPendingTodoEntries([undated], "2026-10-17T00:00:00.000Z")[0].category).toBe("upcoming");
    expect(buildPendingTodoEntries([{ ...undated, must_complete_by: null }], "2026-10-17T00:00:00.000Z")[0].category).toBe("undated");
  });
});

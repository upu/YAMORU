import { describe, expect, it } from "vitest";

import {
  buildDatedPendingTodo,
  type TaskOccurrenceRow,
  type TaskRuleRow,
} from "../src/app/managed-items/[id]/detail-todos";

describe("ManagedItem詳細のメンテナンスTodo判定(Issue #281)", () => {
  const scheduledFor = "2026-08-27T15:00:00.000Z"; // Tokyo: 8/28
  const dueAt = "2026-08-30T15:00:00.000Z"; // Tokyo: 8/31
  const occurrence: TaskOccurrenceRow = {
    activity_logs: [],
    assignee_user_id: null,
    due_at: dueAt,
    id: "occurrence-1",
    scheduled_for: scheduledFor,
    status: "pending",
  };
  const rule: TaskRuleRow = {
    deadline_kind: "maintenance",
    recurrence_basis: "completion",
    task_occurrences: [occurrence],
    title: "フィルター交換",
  };

  it.each([
    {
      badge: "推奨期間",
      nowIso: "2026-08-29T15:00:00.000Z", // Tokyo: 8/30、80%未満
      tone: "upcoming",
    },
    {
      badge: "そろそろ",
      nowIso: "2026-08-30T15:00:00.000Z", // Tokyo: 8/31、80%以上
      tone: "reminder",
    },
    {
      badge: "推奨期間超過",
      nowIso: "2026-08-31T15:00:00.000Z", // Tokyo: 9/1、上限超過
      tone: "caution",
    },
  ])("$badgeをホームと同じ共通判定から表示する", ({ badge, nowIso, tone }) => {
    expect(buildDatedPendingTodo(rule, occurrence, scheduledFor, dueAt, nowIso))
      .toMatchObject({ badge, tone });
  });
});

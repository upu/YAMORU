import { describe, expect, it } from "vitest";

import {
  buildDatedPendingTodo,
  buildPendingTodos,
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

// Issue #325 / YDR-046: 予定日未定のまま関連する管理対象の詳細へ表示する。
describe("ManagedItem詳細の予定日未定Todo", () => {
  function undatedRule(recurrenceBasis: string): TaskRuleRow {
    return {
      deadline_kind: "strict",
      recurrence_basis: recurrenceBasis,
      task_occurrences: [{
        activity_logs: [],
        assignee_user_id: null,
        due_at: null,
        id: `occurrence-${recurrenceBasis}`,
        scheduled_for: null,
        status: "pending",
      }],
      title: "コーヒーマシーンの石灰除去",
    };
  }

  it("必要になったら繰り返すTodoを、一回限りの「未定」と区別して表示する", () => {
    expect(buildPendingTodos([undatedRule("manual")], "2026-09-12T00:00:00.000Z"))
      .toMatchObject([{
        badge: "必要時",
        dueAt: null,
        meta: "必要になったら繰り返す",
        recurrenceBasis: "manual",
        scheduledFor: null,
      }]);
    expect(buildPendingTodos([undatedRule("once")], "2026-09-12T00:00:00.000Z"))
      .toMatchObject([{ badge: "未定", meta: "予定日: 未定", recurrenceBasis: "once" }]);
  });

  // Issue #325 / YDR-046: 予定日未定はTodo一覧と同じく末尾へ置く。
  it("予定日未定のTodoを日付があるTodoの後ろへ並べる", () => {
    const dated: TaskRuleRow = {
      deadline_kind: "strict",
      recurrence_basis: "once",
      task_occurrences: [{
        activity_logs: [],
        assignee_user_id: null,
        due_at: "2026-09-30T15:00:00.000Z",
        id: "occurrence-dated",
        scheduled_for: "2026-09-30T15:00:00.000Z",
        status: "pending",
      }],
      title: "点検",
    };

    expect(
      buildPendingTodos([undatedRule("manual"), dated], "2026-09-12T00:00:00.000Z")
        .map((todo) => todo.id),
    ).toEqual(["occurrence-dated", "occurrence-manual"]);
  });

  it("予定日未定を許さない方式では失敗させる", () => {
    expect(() => buildPendingTodos([undatedRule("calendar")], "2026-09-12T00:00:00.000Z"))
      .toThrow("予定日未定を利用できないTodoです。");
  });
});

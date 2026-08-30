// ManagedItem詳細が表示する、関連Todoと直近の実施記録の組み立て(#280)。
// D1から取れる行を、画面が扱うカード1件分の形へ変換する部分だけを持つ。

import { selectActiveCompletionLogs } from "../../active-completion";
import {
  MAINTENANCE_DISPLAY_COPY,
  STRICT_DISPLAY_COPY,
  toDeadlineKind,
  toRecurrenceBasis,
  type RecurrenceBasis,
  type TodoTone,
} from "../../task-schedule";
import {
  describeMaintenanceWindowFromIso,
  describeStrictScheduleFromIso,
  getMaintenanceDisplayStateFromIso,
  getStrictDisplayStateFromIso,
} from "../../time-zone";

export type ExternalLinkData = { id: string; url: string };

export type PendingTodoData = {
  assigneeUserId: string | null;
  badge: string;
  dueAt: string | null;
  id: string;
  meta: string;
  recurrenceBasis: RecurrenceBasis;
  scheduledFor: string | null;
  title: string;
  tone: TodoTone;
};

// Issue #240: 独立したLAST ACTIVITYを廃止し、「直近の完了」の各行から
// 「いつ・誰が」を確認できるようにする(YDR-020の実施者表示は維持)。
export type RecentCompletionData = {
  id: string;
  occurredAt: string;
  performerName: string;
  title: string;
};

export const RECURRENCE_LABELS: Record<RecurrenceBasis, string> = {
  calendar: "曜日・日付で繰り返す",
  completion: "繰り返し",
  once: "繰り返しなし",
};

export type ActivityLogRow = {
  action: string;
  id: string;
  occurred_at: string;
  performed_by_user_id: string | null;
  recorded_at: string;
};

export type TaskOccurrenceRow = {
  activity_logs: ActivityLogRow[];
  assignee_user_id: string | null;
  due_at: string | null;
  id: string;
  scheduled_for: string | null;
  status: string;
};

export type TaskRuleRow = {
  deadline_kind: string;
  recurrence_basis: string;
  task_occurrences: TaskOccurrenceRow[];
  title: string;
};

// ホーム(app/page.tsx)と同じYDR-034の4状態分類を使い、
// home/detail間で期限分類・日時表示の結果をそろえる(Issue #36)。ホームは
// 対応開始前のbefore-windowを非表示にするが、詳細は台帳の
// 全体像を見る画面のため、推奨期間前も含めすべての未完了Todoを表示する。
export function buildDatedPendingTodo(
  rule: TaskRuleRow,
  occurrence: TaskOccurrenceRow,
  scheduledFor: string,
  dueAt: string,
  nowIso: string,
): PendingTodoData {
  const deadlineKind = toDeadlineKind(rule.deadline_kind);
  const recurrenceBasis = toRecurrenceBasis(rule.recurrence_basis);
  if (recurrenceBasis !== "completion") {
    if (deadlineKind !== "strict") {
      throw new Error("厳密な期限Todoの期限方式が不正です。");
    }
    const state = getStrictDisplayStateFromIso(dueAt, nowIso);
    const copy = STRICT_DISPLAY_COPY[state];
    return {
      assigneeUserId: occurrence.assignee_user_id,
      badge: copy.badge,
      dueAt,
      id: occurrence.id,
      meta: describeStrictScheduleFromIso(state, dueAt),
      recurrenceBasis,
      scheduledFor,
      title: rule.title,
      tone: copy.tone,
    };
  }
  if (deadlineKind !== "maintenance") {
    throw new Error("完了日基準Todoの期限方式が不正です。");
  }
  const window = { dueAt, scheduledFor };
  const state = getMaintenanceDisplayStateFromIso(window, nowIso);
  const copy = MAINTENANCE_DISPLAY_COPY[state];
  return {
    assigneeUserId: occurrence.assignee_user_id,
    badge: copy.badge,
    dueAt,
    id: occurrence.id,
    meta: describeMaintenanceWindowFromIso(state, window),
    recurrenceBasis,
    scheduledFor,
    title: rule.title,
    tone: copy.tone,
  };
}

export function buildPendingTodo(
  rule: TaskRuleRow,
  occurrence: TaskOccurrenceRow,
  nowIso: string,
): PendingTodoData {
  const scheduledFor = occurrence.scheduled_for;
  const dueAt = occurrence.due_at;
  if ((scheduledFor === null) !== (dueAt === null)) {
    throw new Error("Todoの予定日と期限の組み合わせが不正です。");
  }
  if (scheduledFor !== null && dueAt !== null) {
    return buildDatedPendingTodo(rule, occurrence, scheduledFor, dueAt, nowIso);
  }
  const deadlineKind = toDeadlineKind(rule.deadline_kind);
  const recurrenceBasis = toRecurrenceBasis(rule.recurrence_basis);
  if (recurrenceBasis !== "once" || deadlineKind !== "strict") {
    throw new Error("予定日未定を利用できないTodoです。");
  }
  return {
    assigneeUserId: occurrence.assignee_user_id,
    badge: "未定",
    dueAt: null,
    id: occurrence.id,
    meta: "予定日: 未定",
    recurrenceBasis,
    scheduledFor: null,
    title: rule.title,
    tone: "upcoming",
  };
}

export function buildPendingTodos(taskRules: TaskRuleRow[], nowIso: string): PendingTodoData[] {
  return taskRules
    .flatMap((rule) => rule.task_occurrences
      .filter((occurrence) => occurrence.status === "pending")
      .map((occurrence) => buildPendingTodo(rule, occurrence, nowIso)))
    .sort((left, right) =>
      (left.scheduledFor ?? "").localeCompare(right.scheduledFor ?? "")
    );
}

// Issue #240: 「直近の完了」の各行に実施者を表示するため、TaskRuleごとの
// 最新完了(occurred_at基準、YDR-012)に実施者ID(performed_by_user_id、
// YDR-020)を残したまま返す。実施者名への解決は呼び出し側(D1アクセスが
// 必要)に任せる。
export type RecentCompletionDraft = {
  id: string;
  occurredAt: string;
  performedByUserId: string | null;
  title: string;
};

export function buildRecentCompletions(
  taskRules: TaskRuleRow[],
): RecentCompletionDraft[] {
  return taskRules
    .flatMap((rule) => {
      const completions = rule.task_occurrences.flatMap((occurrence) =>
        selectActiveCompletionLogs([occurrence]).map((log) => ({
          id: occurrence.id,
          occurredAt: log.occurred_at,
          performedByUserId: log.performed_by_user_id,
          title: rule.title,
        })),
      );
      if (completions.length === 0) return [];
      // TaskRuleごとに最新の完了だけを「直近の完了」として表示する。
      return [
        completions.reduce((latest, completion) =>
          completion.occurredAt > latest.occurredAt ? completion : latest,
        ),
      ];
    })
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

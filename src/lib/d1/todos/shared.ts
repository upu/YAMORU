import { addTokyoDays, nextCalendarOccurrence, nextIntervalOccurrence } from "../calendar";
import { D1ConflictError, D1NotFoundError } from "../errors";

// Todo(TaskRule/TaskOccurrence)の操作が共通で使う、家庭の確認・Occurrenceの
// 取得・次回予定の算出(#280)。

export type TaskBasics = { managedItemId: string | null; title: string };

export type OccurrenceWithRule = {
  assignee_user_id: string | null;
  due_at: string | null;
  household_id: string;
  id: string;
  // recurrence_basis='interval'のときだけ非null(Issue #99 / YDR-037)。
  interval_anchor_on: string | null;
  interval_count: number | null;
  interval_unit: string | null;
  managed_item_id: string | null;
  recurrence_basis: string;
  recommended_start_offset: number;
  recommended_until_offset: number;
  schedule_day_of_month: number | null;
  schedule_day_of_week: number | null;
  schedule_kind: string | null;
  schedule_month: number | null;
  schedule_week_of_month: number | null;
  scheduled_for: string | null;
  status: string;
  task_rule_id: string;
};

export async function requireManagedItem(
  db: D1Database,
  householdId: string,
  managedItemId: string | null,
): Promise<void> {
  if (managedItemId === null) return;
  const item = await db
    .prepare("SELECT 1 FROM managed_items WHERE id = ?1 AND household_id = ?2")
    .bind(managedItemId, householdId)
    .first();
  if (item === null) throw new D1NotFoundError("Managed item not found");
}

export async function loadOccurrence(
  db: D1Database,
  householdId: string,
  occurrenceId: string,
): Promise<OccurrenceWithRule> {
  const row = await db.prepare(
    `SELECT o.id, o.household_id, o.task_rule_id, o.scheduled_for, o.due_at,
      o.assignee_user_id, o.status,
      r.recurrence_basis, r.recommended_start_offset, r.recommended_until_offset,
      r.managed_item_id,
      r.schedule_kind, r.schedule_day_of_week, r.schedule_day_of_month,
      r.schedule_week_of_month, r.schedule_month,
      r.interval_unit, r.interval_count, r.interval_anchor_on
     FROM task_occurrences o
     JOIN task_rules r ON r.id = o.task_rule_id AND r.household_id = o.household_id
     WHERE o.id = ?1 AND o.household_id = ?2`,
  ).bind(occurrenceId, householdId).first<OccurrenceWithRule>();
  if (row === null) throw new D1NotFoundError("Occurrence not found");
  return row;
}

export async function requireHouseholdUser(
  db: D1Database,
  householdId: string,
  userId: string,
  message: string,
): Promise<void> {
  const member = await db.prepare(
    "SELECT 1 FROM household_members WHERE household_id = ?1 AND user_id = ?2",
  ).bind(householdId, userId).first();
  if (member === null) throw new D1NotFoundError(message);
}

export function nextOccurrence(
  occurrence: OccurrenceWithRule,
  occurredAt: string,
): { dueAt: string; id: string; scheduledFor: string } | null {
  if (occurrence.recurrence_basis === "once") return null;
  const id = crypto.randomUUID();
  if (occurrence.recurrence_basis === "completion") {
    return {
      dueAt: addTokyoDays(occurredAt, occurrence.recommended_until_offset),
      id,
      scheduledFor: addTokyoDays(occurredAt, occurrence.recommended_start_offset),
    };
  }
  // Issue #99 / YDR-037: 固定間隔の候補列は起点日と間隔だけで決まり、完了日に
  // 引きずられない。飛ばした候補は作らず(YDR-016)、次回を1件だけ作る。
  if (occurrence.recurrence_basis === "interval") {
    if (occurrence.scheduled_for === null) {
      throw new D1ConflictError("Recurring occurrence must have a schedule");
    }
    // DBのCHECK制約(0016)でintervalの3列は必ず揃うが、読み取り側でも揃って
    // いることを確かめ、欠けていれば汎用のErrorではなく409として扱う。
    if (
      occurrence.interval_anchor_on === null || occurrence.interval_count === null ||
      occurrence.interval_unit === null
    ) {
      throw new D1ConflictError("Interval occurrence must have an interval rule");
    }
    const scheduledFor = nextIntervalOccurrence(
      {
        intervalAnchorOn: occurrence.interval_anchor_on,
        intervalCount: occurrence.interval_count,
        intervalUnit: occurrence.interval_unit,
      },
      occurrence.scheduled_for,
      occurredAt,
    );
    return { dueAt: scheduledFor, id, scheduledFor };
  }
  if (occurrence.recurrence_basis === "calendar") {
    if (occurrence.scheduled_for === null) {
      throw new D1ConflictError("Recurring occurrence must have a schedule");
    }
    const scheduledFor = nextCalendarOccurrence(
      {
        scheduleDayOfMonth: occurrence.schedule_day_of_month,
        scheduleDayOfWeek: occurrence.schedule_day_of_week,
        scheduleKind: occurrence.schedule_kind ?? "",
        scheduleMonth: occurrence.schedule_month,
        scheduleWeekOfMonth: occurrence.schedule_week_of_month,
      },
      occurrence.scheduled_for,
      occurredAt,
    );
    return { dueAt: scheduledFor, id, scheduledFor };
  }
  throw new D1ConflictError("Unsupported recurrence basis");
}

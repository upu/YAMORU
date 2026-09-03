import {
  addTokyoCalendarInterval,
  addTokyoDays,
  calendarScheduleFromSpecs,
  isCompletionIntervalUnit,
  nextCalendarOccurrence,
  nextIntervalOccurrence,
  parseCalendarScheduleSpecs,
} from "../calendar";
import { D1ConflictError, D1NotFoundError } from "../errors";
import { calendarScheduleSpecsExpression } from "./rule-snapshot";

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
  recommended_start_value: number | null;
  recommended_unit: string | null;
  recommended_until_offset: number;
  recommended_until_value: number | null;
  schedule_kind: string | null;
  // Issue #102 / YDR-040: 候補指定の正本。JSON配列で読み、候補計算はこの集合
  // だけから行う(task_rulesのschedule_*列は読まない)。
  schedule_specs: string | null;
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
      r.recommended_start_value, r.recommended_until_value, r.recommended_unit,
      r.managed_item_id,
      r.schedule_kind,
      ${calendarScheduleSpecsExpression()} AS schedule_specs,
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

type NextOccurrence = {
  completionCalendarVersion: 1 | null;
  dueAt: string;
  id: string;
  scheduledFor: string;
};

function nextCompletionOccurrence(
  occurrence: OccurrenceWithRule,
  occurredAt: string,
  id: string,
): NextOccurrence {
  const values = [
    occurrence.recommended_start_value,
    occurrence.recommended_until_value,
    occurrence.recommended_unit,
  ];
  if (values.every((value) => value === null)) {
    return {
      completionCalendarVersion: null,
      dueAt: addTokyoDays(occurredAt, occurrence.recommended_until_offset),
      id,
      scheduledFor: addTokyoDays(occurredAt, occurrence.recommended_start_offset),
    };
  }
  if (values.some((value) => value === null)) {
    throw new D1ConflictError("Completion occurrence must have a complete interval rule");
  }
  const unit = occurrence.recommended_unit;
  if (unit === null || !isCompletionIntervalUnit(unit)) {
    throw new D1ConflictError("Completion occurrence has an invalid interval unit");
  }
  return {
    completionCalendarVersion: unit === "month" || unit === "year" ? 1 : null,
    dueAt: addTokyoCalendarInterval(
      occurredAt,
      occurrence.recommended_until_value as number,
      unit,
    ),
    id,
    scheduledFor: addTokyoCalendarInterval(
      occurredAt,
      occurrence.recommended_start_value as number,
      unit,
    ),
  };
}

function nextFixedIntervalOccurrence(
  occurrence: OccurrenceWithRule,
  occurredAt: string,
  id: string,
): NextOccurrence {
  if (occurrence.scheduled_for === null) {
    throw new D1ConflictError("Recurring occurrence must have a schedule");
  }
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
  return { completionCalendarVersion: null, dueAt: scheduledFor, id, scheduledFor };
}

function nextCalendarRuleOccurrence(
  occurrence: OccurrenceWithRule,
  occurredAt: string,
  id: string,
): NextOccurrence {
  if (occurrence.scheduled_for === null) {
    throw new D1ConflictError("Recurring occurrence must have a schedule");
  }
  // 候補指定が読めない定例日ルールは、黙って1件目の曜日だけで進めず失敗させる
  // (YDR-040の7)。
  const specs = parseCalendarScheduleSpecs(occurrence.schedule_specs);
  if (specs.length === 0) {
    throw new D1ConflictError("Calendar occurrence must have a schedule spec");
  }
  const scheduledFor = nextCalendarOccurrence(
    calendarScheduleFromSpecs(specs),
    occurrence.scheduled_for,
    occurredAt,
  );
  return { completionCalendarVersion: null, dueAt: scheduledFor, id, scheduledFor };
}

export function nextOccurrence(
  occurrence: OccurrenceWithRule,
  occurredAt: string,
): NextOccurrence | null {
  if (occurrence.recurrence_basis === "once") return null;
  const id = crypto.randomUUID();
  if (occurrence.recurrence_basis === "completion") {
    return nextCompletionOccurrence(occurrence, occurredAt, id);
  }
  // Issue #99 / YDR-037: 固定間隔の候補列は起点日と間隔だけで決まり、完了日に
  // 引きずられない。飛ばした候補は作らず(YDR-016)、次回を1件だけ作る。
  if (occurrence.recurrence_basis === "interval") {
    return nextFixedIntervalOccurrence(occurrence, occurredAt, id);
  }
  if (occurrence.recurrence_basis === "calendar") {
    return nextCalendarRuleOccurrence(occurrence, occurredAt, id);
  }
  throw new D1ConflictError("Unsupported recurrence basis");
}

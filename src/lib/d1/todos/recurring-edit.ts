import { requireCurrentHouseholdId, requireD1Session, type D1Session } from "../authorization";
import { D1ConflictError } from "../errors";
import { taskRuleSnapshotExpression } from "./rule-snapshot";
import { type OccurrenceWithRule, loadOccurrence, requireHouseholdUser, requireManagedItem } from "./shared";

export type RecurringOccurrenceUpdate = {
  assigneeUserId: string | null;
  dueAt: string;
};

type CalendarRuleUpdate = {
  managedItemId: string | null;
  recurrenceBasis: "calendar";
  scheduleDayOfMonth: number | null;
  scheduleDayOfWeek: number | null;
  scheduleKind: string;
  scheduleMonth: number | null;
  scheduleMonthEnd: boolean;
  scheduleWeekOfMonth: number | null;
  title: string;
};

type CompletionRuleUpdate = {
  managedItemId: string | null;
  recurrenceBasis: "completion";
  recommendedStartOffset: number;
  recommendedStartValue: number;
  recommendedUnit: "day" | "month" | "week" | "year";
  recommendedUntilOffset: number;
  recommendedUntilValue: number;
  title: string;
};

type IntervalRuleUpdate = {
  intervalAnchorOn: string;
  intervalCount: number;
  intervalUnit: "day" | "week";
  managedItemId: string | null;
  recurrenceBasis: "interval";
  title: string;
};

export type RecurringTaskRuleUpdate =
  | CalendarRuleUpdate
  | CompletionRuleUpdate
  | IntervalRuleUpdate;

function recurringRuleValues(input: RecurringTaskRuleUpdate): (number | string | null)[] {
  if (input.recurrenceBasis === "completion") {
    return [
      input.recommendedStartOffset,
      input.recommendedUntilOffset,
      input.recommendedStartValue,
      input.recommendedUntilValue,
      input.recommendedUnit,
      null, null, null, null, null, 0,
      null, null, null,
    ];
  }
  if (input.recurrenceBasis === "calendar") {
    return [
      0, 0, null, null, null,
      input.scheduleKind,
      input.scheduleDayOfWeek,
      input.scheduleDayOfMonth,
      input.scheduleWeekOfMonth,
      input.scheduleMonth,
      input.scheduleMonthEnd ? 1 : 0,
      null, null, null,
    ];
  }
  return [
    0, 0, null, null, null,
    null, null, null, null, null, 0,
    input.intervalUnit,
    input.intervalCount,
    input.intervalAnchorOn,
  ];
}

function recurringRuleUpdateStatement(
  db: D1Database,
  householdId: string,
  occurrence: OccurrenceWithRule,
  input: RecurringTaskRuleUpdate,
): D1PreparedStatement {
  return db.prepare(
    `UPDATE task_rules
        SET title = ?1, managed_item_id = ?2,
            recommended_start_offset = ?6, recommended_until_offset = ?7,
            recommended_start_value = ?8, recommended_until_value = ?9,
            recommended_unit = ?10,
            schedule_kind = ?11, schedule_day_of_week = ?12,
            schedule_day_of_month = ?13, schedule_week_of_month = ?14,
            schedule_month = ?15, schedule_month_end = ?16,
            interval_unit = ?17, interval_count = ?18, interval_anchor_on = ?19
      WHERE id = ?3 AND household_id = ?4 AND recurrence_basis = ?5
        AND EXISTS (
          SELECT 1 FROM task_occurrences
           WHERE id = ?20 AND household_id = ?4 AND status = 'pending'
        )`,
  ).bind(
    input.title,
    input.managedItemId,
    occurrence.task_rule_id,
    householdId,
    input.recurrenceBasis,
    ...recurringRuleValues(input),
    occurrence.id,
  );
}

function assertRecurringOccurrence(
  occurrence: OccurrenceWithRule,
  input: RecurringOccurrenceUpdate,
): void {
  if (occurrence.status !== "pending") throw new D1ConflictError("Occurrence is not pending");
  if (occurrence.recurrence_basis === "once") {
    throw new D1ConflictError("Only recurring tasks can use recurring edit");
  }
  if (occurrence.scheduled_for === null || occurrence.due_at === null) {
    throw new D1ConflictError("Recurring occurrence must have a schedule");
  }
  if (input.dueAt <= new Date().toISOString()) {
    throw new D1ConflictError("new_due_at must be in the future");
  }
  if (input.dueAt < occurrence.scheduled_for) {
    throw new D1ConflictError("new_due_at must not be before scheduled_for");
  }
}

function assigneeStatements(
  db: D1Database,
  householdId: string,
  userId: string,
  occurrence: OccurrenceWithRule,
  input: RecurringOccurrenceUpdate,
): D1PreparedStatement[] {
  if (occurrence.assignee_user_id === input.assigneeUserId) return [];
  const logId = crypto.randomUUID();
  return [
    db.prepare(
      `INSERT INTO activity_logs (
        id, household_id, task_occurrence_id, action, actor_user_id,
        occurred_at, assignee_user_id, previous_assignee_user_id, new_assignee_user_id
      ) SELECT ?1, ?2, ?3, 'assignee_changed', ?4, ?5, ?6, ?7, ?6
        WHERE EXISTS (SELECT 1 FROM task_occurrences
          WHERE id = ?3 AND household_id = ?2 AND status = 'pending')`,
    ).bind(logId, householdId, occurrence.id, userId, new Date().toISOString(),
      input.assigneeUserId, occurrence.assignee_user_id),
    db.prepare(
      `UPDATE task_occurrences SET assignee_user_id = ?1
        WHERE id = ?2 AND household_id = ?3 AND status = 'pending'
          AND EXISTS (SELECT 1 FROM activity_logs WHERE id = ?4 AND household_id = ?3)`,
    ).bind(input.assigneeUserId, occurrence.id, householdId, logId),
  ];
}

function dueDateStatements(
  db: D1Database,
  householdId: string,
  userId: string,
  occurrence: OccurrenceWithRule,
  input: RecurringOccurrenceUpdate,
): D1PreparedStatement[] {
  if (occurrence.due_at === input.dueAt) return [];
  const logId = crypto.randomUUID();
  return [
    db.prepare(
      `INSERT INTO activity_logs (
        id, household_id, task_occurrence_id, action, actor_user_id,
        occurred_at, previous_due_at, new_due_at
      ) SELECT ?1, ?2, ?3, 'postponed', ?4, ?5, ?6, ?7
        WHERE EXISTS (SELECT 1 FROM task_occurrences
          WHERE id = ?3 AND household_id = ?2 AND status = 'pending')`,
    ).bind(logId, householdId, occurrence.id, userId, new Date().toISOString(),
      occurrence.due_at, input.dueAt),
    db.prepare(
      `UPDATE task_occurrences SET due_at = ?1
        WHERE id = ?2 AND household_id = ?3 AND status = 'pending'
          AND EXISTS (SELECT 1 FROM activity_logs WHERE id = ?4 AND household_id = ?3)`,
    ).bind(input.dueAt, occurrence.id, householdId, logId),
  ];
}

// Issue #265 / YDR-039: 現在回の担当・期限だけを同じbatchで変更する。
// scheduled_forはYDR-012の本来の予定として保持し、ルールや過去回には触れない。
export async function updateRecurringOccurrence(
  db: D1Database,
  session: D1Session,
  occurrenceId: string,
  input: RecurringOccurrenceUpdate,
): Promise<void> {
  const user = requireD1Session(session);
  const householdId = await requireCurrentHouseholdId(db, session);
  if (input.assigneeUserId !== null) {
    await requireHouseholdUser(db, householdId, input.assigneeUserId, "Assignee not found");
  }
  const occurrence = await loadOccurrence(db, householdId, occurrenceId);
  assertRecurringOccurrence(occurrence, input);
  const statements = [
    ...assigneeStatements(db, householdId, user.userId, occurrence, input),
    ...dueDateStatements(db, householdId, user.userId, occurrence, input),
  ];
  if (statements.length === 0) return;
  const results = await db.batch(statements);
  const missingLog = results.some((result, index) => index % 2 === 0 && result.meta.changes !== 1);
  if (missingLog) throw new D1ConflictError("Occurrence is not pending");
}

// Issue #265 / YDR-039: 名前・関連先・同じ方式内の繰り返し条件を、現在回の
// scheduled_for/due_atを動かさず更新する。現在回のsnapshotは新しい表示へ
// 揃える一方、完了済みOccurrenceのsnapshotは更新しない。
const PENDING_RECURRING_OCCURRENCE_SQL = `SELECT 1 FROM task_occurrences o
  JOIN task_rules r ON r.id = o.task_rule_id AND r.household_id = o.household_id
 WHERE o.id = ?1 AND o.household_id = ?2 AND o.status = 'pending'
   AND r.recurrence_basis = ?3`;

export async function updateRecurringTaskRule(
  db: D1Database,
  session: D1Session,
  occurrenceId: string,
  input: RecurringTaskRuleUpdate,
): Promise<{ previousManagedItemId: string | null }> {
  const user = requireD1Session(session);
  const householdId = await requireCurrentHouseholdId(db, session);
  await requireManagedItem(db, householdId, input.managedItemId);
  const occurrence = await loadOccurrence(db, householdId, occurrenceId);
  if (occurrence.status !== "pending") throw new D1ConflictError("Occurrence is not pending");
  if (occurrence.recurrence_basis === "once") {
    throw new D1ConflictError("Only recurring tasks can use recurring edit");
  }
  if (occurrence.recurrence_basis !== input.recurrenceBasis) {
    throw new D1ConflictError("Recurrence basis cannot be changed");
  }

  const changeId = crypto.randomUUID();
  const snapshot = taskRuleSnapshotExpression();
  const results = await db.batch([
    recurringRuleUpdateStatement(db, householdId, occurrence, input),
    db.prepare(
      `INSERT INTO task_rule_changes (
        id, household_id, task_rule_id, task_occurrence_id, actor_user_id,
        previous_rule_snapshot, new_rule_snapshot
      )
      SELECT ?1, ?2, o.task_rule_id, o.id, ?3, o.rule_snapshot, ${snapshot}
       FROM task_occurrences o
        JOIN task_rules r ON r.id = o.task_rule_id AND r.household_id = o.household_id
        LEFT JOIN managed_items i
          ON i.id = r.managed_item_id AND i.household_id = r.household_id
       WHERE o.id = ?4 AND o.household_id = ?2 AND o.status = 'pending'
         AND o.rule_snapshot <> ${snapshot}`,
    ).bind(changeId, householdId, user.userId, occurrenceId),
    db.prepare(
      `UPDATE task_occurrences
          SET rule_snapshot = (
            SELECT new_rule_snapshot FROM task_rule_changes
             WHERE id = ?1 AND household_id = ?2
          )
        WHERE id = ?3 AND household_id = ?2 AND status = 'pending'
          AND EXISTS (
            SELECT 1 FROM task_rule_changes WHERE id = ?1 AND household_id = ?2
          )`,
    ).bind(changeId, householdId, occurrenceId),
  ]);
  if ((results[1]?.meta.changes ?? 0) === 0) {
    const pending = await db.prepare(PENDING_RECURRING_OCCURRENCE_SQL)
      .bind(occurrenceId, householdId, input.recurrenceBasis).first();
    if (pending === null) throw new D1ConflictError("Occurrence is not pending");
    return { previousManagedItemId: occurrence.managed_item_id };
  }
  if ((results[2]?.meta.changes ?? 0) !== 1) {
    throw new D1ConflictError("Occurrence is not pending");
  }
  return { previousManagedItemId: occurrence.managed_item_id };
}

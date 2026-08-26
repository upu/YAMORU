import {
  requireCurrentHouseholdId,
  requireD1Session,
  type D1Session,
} from "./authorization";
import {
  addTokyoDays,
  calendarScheduledForOnOrAfter,
  nextCalendarOccurrence,
  tokyoDateFromIso,
} from "./calendar";
import { D1ConflictError, D1NotFoundError } from "./errors";

type TaskBasics = { managedItemId: string | null; title: string };
export type OneTimeTaskInput = TaskBasics & { scheduledFor: string | null };
export type MaintenanceTaskInput = TaskBasics & {
  firstDueAt: string;
  firstScheduledFor: string;
  recommendedStartOffset: number;
  recommendedUntilOffset: number;
};
export type CalendarTaskInput = TaskBasics & {
  scheduleDayOfMonth: number | null;
  scheduleDayOfWeek: number | null;
  scheduleKind: string;
  // Issue #227 / YDR-032: 「毎月末」は schedule_kind='monthly_day' /
  // scheduleDayOfMonth=31 と組み合わせて保存する。候補計算には使わない
  // (src/lib/d1/calendar.tsは変更しない)。
  scheduleMonthEnd: boolean;
  scheduleMonth: number | null;
  scheduleWeekOfMonth: number | null;
};

type OccurrenceWithRule = {
  assignee_user_id: string | null;
  due_at: string | null;
  household_id: string;
  id: string;
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

async function requireManagedItem(
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

async function insertTask(
  db: D1Database,
  householdId: string,
  input: TaskBasics & {
    deadlineKind: string;
    dueAt: string | null;
    recurrenceBasis: string;
    recommendedStartOffset: number;
    recommendedUntilOffset: number;
    schedule?: CalendarTaskInput;
    scheduledFor: string | null;
  },
): Promise<string> {
  await requireManagedItem(db, householdId, input.managedItemId);
  const taskRuleId = crypto.randomUUID();
  const occurrenceId = crypto.randomUUID();
  const schedule = input.schedule;
  await db.batch([
    db.prepare(
      `INSERT INTO task_rules (
        id, household_id, managed_item_id, title, recurrence_basis,
        deadline_kind, recommended_start_offset, recommended_until_offset,
        schedule_kind, schedule_day_of_week, schedule_day_of_month,
        schedule_week_of_month, schedule_month, schedule_month_end
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
    ).bind(
      taskRuleId,
      householdId,
      input.managedItemId,
      input.title,
      input.recurrenceBasis,
      input.deadlineKind,
      input.recommendedStartOffset,
      input.recommendedUntilOffset,
      schedule?.scheduleKind ?? null,
      schedule?.scheduleDayOfWeek ?? null,
      schedule?.scheduleDayOfMonth ?? null,
      schedule?.scheduleWeekOfMonth ?? null,
      schedule?.scheduleMonth ?? null,
      schedule?.scheduleMonthEnd === true ? 1 : 0,
    ),
    db.prepare(
      "INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(occurrenceId, householdId, taskRuleId, input.scheduledFor, input.dueAt),
  ]);
  return taskRuleId;
}

export async function createOneTimeTask(
  db: D1Database,
  session: D1Session,
  input: OneTimeTaskInput,
): Promise<string> {
  const householdId = await requireCurrentHouseholdId(db, session);
  return insertTask(db, householdId, {
    ...input,
    deadlineKind: "strict",
    dueAt: input.scheduledFor,
    recurrenceBasis: "once",
    recommendedStartOffset: 0,
    recommendedUntilOffset: 0,
  });
}

export async function createMaintenanceTask(
  db: D1Database,
  session: D1Session,
  input: MaintenanceTaskInput,
): Promise<string> {
  const householdId = await requireCurrentHouseholdId(db, session);
  return insertTask(db, householdId, {
    ...input,
    deadlineKind: "maintenance",
    dueAt: input.firstDueAt,
    recurrenceBasis: "completion",
    scheduledFor: input.firstScheduledFor,
  });
}

export async function createCalendarTask(
  db: D1Database,
  session: D1Session,
  input: CalendarTaskInput,
  now = new Date(),
): Promise<string> {
  const householdId = await requireCurrentHouseholdId(db, session);
  const first = calendarScheduledForOnOrAfter(input, tokyoDateFromIso(now.toISOString()));
  return insertTask(db, householdId, {
    ...input,
    deadlineKind: "strict",
    dueAt: first,
    recurrenceBasis: "calendar",
    recommendedStartOffset: 0,
    recommendedUntilOffset: 0,
    schedule: input,
    scheduledFor: first,
  });
}

async function loadOccurrence(
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
      r.schedule_week_of_month, r.schedule_month
     FROM task_occurrences o
     JOIN task_rules r ON r.id = o.task_rule_id AND r.household_id = o.household_id
     WHERE o.id = ?1 AND o.household_id = ?2`,
  ).bind(occurrenceId, householdId).first<OccurrenceWithRule>();
  if (row === null) throw new D1NotFoundError("Occurrence not found");
  return row;
}

async function requireHouseholdUser(
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

function nextOccurrence(
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

async function findCompletionReplay(
  db: D1Database,
  householdId: string,
  idempotencyKey: string,
): Promise<{ next_task_occurrence_id: string | null; performed_by_user_id: string; task_occurrence_id: string } | null> {
  return db.prepare(
    `SELECT next_task_occurrence_id, performed_by_user_id, task_occurrence_id
       FROM activity_logs
      WHERE household_id = ?1 AND idempotency_key = ?2 AND action = 'completed'`,
  ).bind(householdId, idempotencyKey).first();
}

function completionStatements(
  db: D1Database,
  input: {
    actorId: string;
    householdId: string;
    idempotencyKey: string;
    next: ReturnType<typeof nextOccurrence>;
    occurredAt: string;
    occurrence: OccurrenceWithRule;
    performerId: string;
  },
): D1PreparedStatement[] {
  const logId = crypto.randomUUID();
  const statements = [
    db.prepare(
      `INSERT INTO activity_logs (
        id, household_id, task_occurrence_id, action, actor_user_id,
        performed_by_user_id, occurred_at, idempotency_key, next_task_occurrence_id
      ) SELECT ?1, ?2, ?3, 'completed', ?4, ?5, ?6, ?7, ?8
        WHERE EXISTS (
          SELECT 1 FROM task_occurrences
           WHERE id = ?3 AND household_id = ?2 AND status = 'pending'
        )`,
    ).bind(
      logId,
      input.householdId,
      input.occurrence.id,
      input.actorId,
      input.performerId,
      input.occurredAt,
      input.idempotencyKey,
      input.next?.id ?? null,
    ),
    db.prepare(
      `UPDATE task_occurrences SET status = 'completed'
        WHERE id = ?1 AND household_id = ?2 AND status = 'pending'
          AND EXISTS (
            SELECT 1 FROM activity_logs WHERE id = ?3 AND household_id = ?2
          )`,
    ).bind(input.occurrence.id, input.householdId, logId),
  ];
  if (input.next !== null) {
    statements.push(db.prepare(
      `INSERT INTO task_occurrences (
        id, household_id, task_rule_id, scheduled_for, due_at
      ) SELECT ?1, ?2, ?3, ?4, ?5
        WHERE EXISTS (
          SELECT 1 FROM activity_logs WHERE id = ?6 AND household_id = ?2
        )`,
    ).bind(
      input.next.id,
      input.householdId,
      input.occurrence.task_rule_id,
      input.next.scheduledFor,
      input.next.dueAt,
      logId,
    ));
  }
  return statements;
}

function completionReplayResult(
  replay: NonNullable<Awaited<ReturnType<typeof findCompletionReplay>>>,
  occurrenceId: string,
  performerId: string,
): string | null {
  if (replay.task_occurrence_id !== occurrenceId || replay.performed_by_user_id !== performerId) {
    throw new D1ConflictError("Idempotency key was already used for a different occurrence");
  }
  return replay.next_task_occurrence_id;
}

function isNextOccurrenceCollision(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message.includes("UNIQUE constraint failed") && message.includes("task_occurrences");
}

async function runCompletionBatch(
  db: D1Database,
  statements: D1PreparedStatement[],
): Promise<D1Result[]> {
  try {
    return await db.batch(statements);
  } catch (error) {
    if (isNextOccurrenceCollision(error)) {
      throw new D1ConflictError("Next occurrence already exists for the computed schedule");
    }
    throw error;
  }
}

async function resolveCompletionConflict(
  db: D1Database,
  householdId: string,
  input: { idempotencyKey: string; occurrenceId: string },
  performerId: string,
): Promise<string | null> {
  const replay = await findCompletionReplay(db, householdId, input.idempotencyKey);
  if (replay !== null) return completionReplayResult(replay, input.occurrenceId, performerId);
  throw new D1ConflictError("Occurrence is not pending");
}

export async function completeTask(
  db: D1Database,
  session: D1Session,
  input: {
    idempotencyKey: string;
    occurredAt: string | null;
    occurrenceId: string;
    performedByUserId: string | null;
  },
): Promise<string | null> {
  const user = requireD1Session(session);
  const householdId = await requireCurrentHouseholdId(db, session);
  const performerId = input.performedByUserId ?? user.userId;
  const replay = await findCompletionReplay(db, householdId, input.idempotencyKey);
  if (replay !== null) return completionReplayResult(replay, input.occurrenceId, performerId);
  const occurrence = await loadOccurrence(db, householdId, input.occurrenceId);
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  if (occurredAt > new Date().toISOString()) throw new D1ConflictError("occurred_at must not be in the future");
  await requireHouseholdUser(db, householdId, performerId, "Performer not found");
  const next = nextOccurrence(occurrence, occurredAt);
  const results = await runCompletionBatch(
    db,
    completionStatements(db, {
      actorId: user.userId,
      householdId,
      idempotencyKey: input.idempotencyKey,
      next,
      occurredAt,
      occurrence,
      performerId,
    }),
  );
  return (results[0]?.meta.changes ?? 0) === 1
    ? next?.id ?? null
    : resolveCompletionConflict(db, householdId, input, performerId);
}

export async function setTaskOccurrenceAssignee(
  db: D1Database,
  session: D1Session,
  occurrenceId: string,
  assigneeUserId: string | null,
): Promise<void> {
  const user = requireD1Session(session);
  const householdId = await requireCurrentHouseholdId(db, session);
  if (assigneeUserId !== null) {
    await requireHouseholdUser(db, householdId, assigneeUserId, "Assignee not found");
  }
  const occurrence = await loadOccurrence(db, householdId, occurrenceId);
  const logId = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(
      `INSERT INTO activity_logs (
        id, household_id, task_occurrence_id, action, actor_user_id,
        occurred_at, assignee_user_id, previous_assignee_user_id,
        new_assignee_user_id
      ) SELECT ?1, ?2, ?3, 'assignee_changed', ?4, ?5, ?6, ?7, ?6
        WHERE EXISTS (
          SELECT 1 FROM task_occurrences
           WHERE id = ?3 AND household_id = ?2 AND status = 'pending'
        )`,
    ).bind(
      logId,
      householdId,
      occurrenceId,
      user.userId,
      new Date().toISOString(),
      assigneeUserId,
      occurrence.assignee_user_id,
    ),
    db.prepare(
      `UPDATE task_occurrences SET assignee_user_id = ?1
        WHERE id = ?2 AND household_id = ?3 AND status = 'pending'
          AND EXISTS (
            SELECT 1 FROM activity_logs WHERE id = ?4 AND household_id = ?3
          )`,
    ).bind(assigneeUserId, occurrenceId, householdId, logId),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1) throw new D1ConflictError("Occurrence is not pending");
}

// Issue #77: 未担当のOccurrenceを、操作主体自身の担当として一操作で引き受け
// る(「やるよ」)。setTaskOccurrenceAssigneeと違い、対象は常に呼び出したセッ
// ション自身(YDR-020と同様、クライアントから担当者IDを受け取らない)で、
// 既に誰かが担当している場合は黙って上書きしない。ガードに
// assignee_user_id IS NULLを含めることで、同時に二人が「やるよ」を押しても
// 片方だけが成功する(先にcommitした側がNULLを消費し、後着はガード不成立で
// 0行のまま失敗する)。
export async function claimTaskOccurrenceAssignee(
  db: D1Database,
  session: D1Session,
  occurrenceId: string,
): Promise<void> {
  const user = requireD1Session(session);
  const householdId = await requireCurrentHouseholdId(db, session);
  await loadOccurrence(db, householdId, occurrenceId);
  const logId = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(
      `INSERT INTO activity_logs (
        id, household_id, task_occurrence_id, action, actor_user_id,
        occurred_at, assignee_user_id, previous_assignee_user_id,
        new_assignee_user_id
      ) SELECT ?1, ?2, ?3, 'assignee_changed', ?4, ?5, ?4, NULL, ?4
        WHERE EXISTS (
          SELECT 1 FROM task_occurrences
           WHERE id = ?3 AND household_id = ?2 AND status = 'pending'
             AND assignee_user_id IS NULL
        )`,
    ).bind(logId, householdId, occurrenceId, user.userId, new Date().toISOString()),
    db.prepare(
      `UPDATE task_occurrences SET assignee_user_id = ?1
        WHERE id = ?2 AND household_id = ?3 AND status = 'pending'
          AND assignee_user_id IS NULL
          AND EXISTS (
            SELECT 1 FROM activity_logs WHERE id = ?4 AND household_id = ?3
          )`,
    ).bind(user.userId, occurrenceId, householdId, logId),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1) {
    throw new D1ConflictError("Occurrence already has an assignee");
  }
}

export async function postponeTaskOccurrence(
  db: D1Database,
  session: D1Session,
  occurrenceId: string,
  dueAt: string,
): Promise<void> {
  const user = requireD1Session(session);
  const householdId = await requireCurrentHouseholdId(db, session);
  const occurrence = await loadOccurrence(db, householdId, occurrenceId);
  if (occurrence.scheduled_for === null || occurrence.due_at === null) {
    throw new D1ConflictError("Cannot postpone an undated occurrence");
  }
  if (dueAt <= new Date().toISOString()) throw new D1ConflictError("new_due_at must be in the future");
  if (dueAt < occurrence.scheduled_for) throw new D1ConflictError("new_due_at must not be before scheduled_for");
  const logId = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(
      `INSERT INTO activity_logs (
        id, household_id, task_occurrence_id, action, actor_user_id, occurred_at,
        previous_due_at, new_due_at
      ) SELECT ?1, ?2, ?3, 'postponed', ?4, ?5, ?6, ?7
        WHERE EXISTS (
          SELECT 1 FROM task_occurrences
           WHERE id = ?3 AND household_id = ?2 AND status = 'pending'
        )`,
    ).bind(
      logId,
      householdId,
      occurrenceId,
      user.userId,
      new Date().toISOString(),
      occurrence.due_at,
      dueAt,
    ),
    db.prepare(
      `UPDATE task_occurrences SET due_at = ?1
        WHERE id = ?2 AND household_id = ?3 AND status = 'pending'
          AND EXISTS (
            SELECT 1 FROM activity_logs WHERE id = ?4 AND household_id = ?3
          )`,
    ).bind(dueAt, occurrenceId, householdId, logId),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1) throw new D1ConflictError("Occurrence is not pending");
}

// YDR-030: 一回限りのpending Occurrenceだけ、具体日と予定日未定を往復
// できる。具体日を設定する場合はscheduled_for/due_atを同日にし、未定へ
// 戻す場合は両方をNULLにしてペアの整合性を維持する。
export async function setOneTimeTaskSchedule(
  db: D1Database,
  session: D1Session,
  occurrenceId: string,
  scheduledFor: string | null,
): Promise<void> {
  const householdId = await requireCurrentHouseholdId(db, session);
  const occurrence = await loadOccurrence(db, householdId, occurrenceId);
  if (occurrence.recurrence_basis !== "once") {
    throw new D1ConflictError("Only one-time tasks can have an undated schedule");
  }
  const result = await db.prepare(
    `UPDATE task_occurrences
        SET scheduled_for = ?1, due_at = ?1
      WHERE id = ?2 AND household_id = ?3 AND status = 'pending'`,
  ).bind(scheduledFor, occurrenceId, householdId).run();
  if (result.meta.changes !== 1) {
    throw new D1ConflictError("Occurrence is not pending");
  }
}

// Issue #203 / #205: Todo詳細・編集画面が読む、Todo一件の内容。TaskRule(名前、
// 繰り返し方式、関連ManagedItem)と現在のTaskOccurrence(予定日、期限、担当、状態)
// を一つの読み取りにまとめる。完了済みの場合は、現在有効な実施日時・実施者
// (訂正済みなら訂正後、YDR-026)も返す。現在の家庭のOccurrenceだけを返す。
export type TodoDetailRow = {
  assignee_user_id: string | null;
  // 完了済みTodoでだけ非null。実施記録の訂正・取消が対象にする完了ログ。
  completed_activity_log_id: string | null;
  deadline_kind: string;
  due_at: string | null;
  id: string;
  managed_item_id: string | null;
  managed_item_name: string | null;
  // 現在有効な実施日時・実施者。完了ログがない間はnull。
  occurred_at: string | null;
  performed_by_user_id: string | null;
  recurrence_basis: string;
  scheduled_for: string | null;
  // recurrence_basis='calendar'のときだけ非null。定例パターンの表示に使う
  // (Issue #227 / YDR-032)。
  schedule_day_of_month: number | null;
  schedule_day_of_week: number | null;
  schedule_kind: string | null;
  schedule_month: number | null;
  schedule_month_end: number;
  schedule_week_of_month: number | null;
  status: string;
  title: string;
};

export async function loadTodoDetail(
  db: D1Database,
  session: D1Session,
  occurrenceId: string,
): Promise<TodoDetailRow | null> {
  const householdId = await requireCurrentHouseholdId(db, session);
  // 完了→取消→再完了でも、対象は最新のcompletedログ1件に絞る
  // (loadActiveCompletionと同じ並び)。訂正は日時・実施者を別行として残すため、
  // それぞれ独立に最新の訂正を引き、なければ元の値へフォールバックする。
  return db.prepare(
    `WITH completion AS (
       SELECT l.id, l.occurred_at, l.performed_by_user_id
         FROM activity_logs l
        WHERE l.household_id = ?2 AND l.task_occurrence_id = ?1
          AND l.action = 'completed'
        ORDER BY l.recorded_at DESC, l.id DESC
        LIMIT 1
     )
     SELECT o.id, o.scheduled_for, o.due_at, o.assignee_user_id, o.status,
            r.title, r.recurrence_basis, r.deadline_kind,
            r.schedule_kind, r.schedule_day_of_week, r.schedule_day_of_month,
            r.schedule_week_of_month, r.schedule_month, r.schedule_month_end,
            i.id AS managed_item_id, i.name AS managed_item_name,
            c.id AS completed_activity_log_id,
            coalesce(
              (SELECT k.new_occurred_at FROM completion_corrections k
                 WHERE k.completed_activity_log_id = c.id AND k.household_id = ?2
                   AND k.new_occurred_at IS NOT NULL
                 ORDER BY k.corrected_at DESC, k.id DESC LIMIT 1),
              c.occurred_at
            ) AS occurred_at,
            coalesce(
              (SELECT k.new_performed_by_user_id FROM completion_corrections k
                 WHERE k.completed_activity_log_id = c.id AND k.household_id = ?2
                   AND k.new_performed_by_user_id IS NOT NULL
                 ORDER BY k.corrected_at DESC, k.id DESC LIMIT 1),
              c.performed_by_user_id
            ) AS performed_by_user_id
       FROM task_occurrences o
       JOIN task_rules r ON r.id = o.task_rule_id AND r.household_id = o.household_id
       LEFT JOIN managed_items i ON i.id = r.managed_item_id AND i.household_id = r.household_id
       LEFT JOIN completion c ON 1 = 1
      WHERE o.id = ?1 AND o.household_id = ?2
        AND o.status IN ('pending', 'completed')`,
  ).bind(occurrenceId, householdId).first<TodoDetailRow>();
}

export type OneTimeTodoUpdate = {
  assigneeUserId: string | null;
  managedItemId: string | null;
  scheduledFor: string | null;
  title: string;
};

function isOccurrenceScheduleCollision(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message.includes("UNIQUE constraint failed")
    && message.includes("task_occurrences");
}

// 担当変更は、パネルからの変更(setTaskOccurrenceAssignee)と同じ
// 'assignee_changed'として履歴に残す(YDR-020)。名前・関連ManagedItem・予定日の
// 変更に対応するActivityLogのactionはないため、記録するのは担当だけにする。
function assigneeChangeStatement(
  db: D1Database,
  input: {
    actorId: string;
    householdId: string;
    logId: string;
    newAssigneeUserId: string | null;
    occurrenceId: string;
    previousAssigneeUserId: string | null;
  },
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO activity_logs (
      id, household_id, task_occurrence_id, action, actor_user_id,
      occurred_at, assignee_user_id, previous_assignee_user_id,
      new_assignee_user_id
    ) SELECT ?1, ?2, ?3, 'assignee_changed', ?4, ?5, ?6, ?7, ?6
      WHERE EXISTS (
        SELECT 1 FROM task_occurrences
         WHERE id = ?3 AND household_id = ?2 AND status = 'pending'
      )`,
  ).bind(
    input.logId,
    input.householdId,
    input.occurrenceId,
    input.actorId,
    new Date().toISOString(),
    input.newAssigneeUserId,
    input.previousAssigneeUserId,
  );
}

function oneTimeTodoStatements(
  db: D1Database,
  householdId: string,
  occurrence: OccurrenceWithRule,
  input: OneTimeTodoUpdate,
): D1PreparedStatement[] {
  return [
    // TaskRuleとTaskOccurrenceのどちらの更新も、同じpending条件を満たすときだけ
    // 適用する。片方だけが通って途中状態が残ることを防ぐ(YDR-014)。
    db.prepare(
      `UPDATE task_rules SET title = ?1, managed_item_id = ?2
        WHERE id = ?3 AND household_id = ?4 AND recurrence_basis = 'once'
          AND EXISTS (
            SELECT 1 FROM task_occurrences
             WHERE id = ?5 AND household_id = ?4 AND status = 'pending'
          )`,
    ).bind(
      input.title,
      input.managedItemId,
      occurrence.task_rule_id,
      householdId,
      occurrence.id,
    ),
    // 予定日は変えたときだけ書き換える。延期でdue_atだけを動かしたTodo
    // (YDR-012)の期限を、名前や担当だけの編集で巻き戻さない。予定日を変えた
    // ときは、一回限りTodoの往復と同じくscheduled_forとdue_atを揃える(YDR-030)。
    occurrence.scheduled_for === input.scheduledFor
      ? db.prepare(
          `UPDATE task_occurrences SET assignee_user_id = ?1
            WHERE id = ?2 AND household_id = ?3 AND status = 'pending'`,
        ).bind(input.assigneeUserId, occurrence.id, householdId)
      : db.prepare(
          `UPDATE task_occurrences
              SET assignee_user_id = ?1, scheduled_for = ?2, due_at = ?2
            WHERE id = ?3 AND household_id = ?4 AND status = 'pending'`,
        ).bind(input.assigneeUserId, input.scheduledFor, occurrence.id, householdId),
  ];
}

// Issue #203: 繰り返しなしTodoの名前・関連ManagedItem・担当者・予定日を、一つの
// batch(暗黙のトランザクション)でまとめて更新する。途中で失敗した場合は
// TaskRule側だけが変わった状態を残さない。戻り値は変更前の関連ManagedItem
// (呼び出し側が変更前後の詳細画面を再検証するため)。
export async function updateOneTimeTodo(
  db: D1Database,
  session: D1Session,
  occurrenceId: string,
  input: OneTimeTodoUpdate,
): Promise<{ previousManagedItemId: string | null }> {
  const user = requireD1Session(session);
  const householdId = await requireCurrentHouseholdId(db, session);
  if (input.assigneeUserId !== null) {
    await requireHouseholdUser(db, householdId, input.assigneeUserId, "Assignee not found");
  }
  await requireManagedItem(db, householdId, input.managedItemId);

  const occurrence = await loadOccurrence(db, householdId, occurrenceId);
  if (occurrence.status !== "pending") {
    throw new D1ConflictError("Occurrence is not pending");
  }
  if (occurrence.recurrence_basis !== "once") {
    throw new D1ConflictError("Only one-time tasks can be edited");
  }

  const statements = oneTimeTodoStatements(db, householdId, occurrence, input);
  if (occurrence.assignee_user_id !== input.assigneeUserId) {
    statements.unshift(assigneeChangeStatement(db, {
      actorId: user.userId,
      householdId,
      logId: crypto.randomUUID(),
      newAssigneeUserId: input.assigneeUserId,
      occurrenceId,
      previousAssigneeUserId: occurrence.assignee_user_id,
    }));
  }

  let results: D1Result[];
  try {
    results = await db.batch(statements);
  } catch (error) {
    if (isOccurrenceScheduleCollision(error)) {
      throw new D1ConflictError("Occurrence already exists for the schedule");
    }
    throw error;
  }
  if ((results[results.length - 1]?.meta.changes ?? 0) !== 1) {
    throw new D1ConflictError("Occurrence is not pending");
  }
  return { previousManagedItemId: occurrence.managed_item_id };
}

type ActiveCompletion = {
  id: string;
  next_task_occurrence_id: string | null;
};

// undoTaskCompletion・correctCompletionOccurredAt・correctCompletionPerformerが
// 共通で必要とする「このOccurrenceに対する現在有効なcompletedログ」を取得する。
// undo→再完了が起きていても、直近の1件だけを対象にする。
async function loadActiveCompletion(
  db: D1Database,
  householdId: string,
  occurrenceId: string,
): Promise<ActiveCompletion> {
  const completion = await db.prepare(
    `SELECT id, next_task_occurrence_id
       FROM activity_logs
      WHERE household_id = ?1 AND task_occurrence_id = ?2 AND action = 'completed'
      ORDER BY recorded_at DESC, id DESC LIMIT 1`,
  ).bind(householdId, occurrenceId).first<ActiveCompletion>();
  if (completion === null) throw new D1ConflictError("Occurrence is not completed");
  return completion;
}

type EffectiveCompletion = {
  occurredAt: string;
  performedByUserId: string | null;
};

// #148: 元のcompletedログは書き換えない(YDR-015・YDR-026)。有効な実施日時・
// 実施者は、そのログを対象とした最新の訂正(completion_corrections)を読み取り
// 時に解決して求める。日時訂正と実施者訂正は別行なので、それぞれ独立に
// 「最新の訂正」を相関サブクエリで引く。
async function resolveEffectiveCompletion(
  db: D1Database,
  householdId: string,
  completedActivityLogId: string,
): Promise<EffectiveCompletion> {
  const row = await db.prepare(
    `SELECT
       al.occurred_at,
       al.performed_by_user_id,
       (SELECT c.new_occurred_at FROM completion_corrections c
          WHERE c.completed_activity_log_id = al.id AND c.household_id = al.household_id
            AND c.new_occurred_at IS NOT NULL
          ORDER BY c.corrected_at DESC, c.id DESC LIMIT 1) AS corrected_occurred_at,
       (SELECT c.new_performed_by_user_id FROM completion_corrections c
          WHERE c.completed_activity_log_id = al.id AND c.household_id = al.household_id
            AND c.new_performed_by_user_id IS NOT NULL
          ORDER BY c.corrected_at DESC, c.id DESC LIMIT 1) AS corrected_performed_by_user_id
     FROM activity_logs al
     WHERE al.id = ?1 AND al.household_id = ?2`,
  ).bind(completedActivityLogId, householdId).first<{
    corrected_occurred_at: string | null;
    corrected_performed_by_user_id: string | null;
    occurred_at: string;
    performed_by_user_id: string | null;
  }>();
  if (row === null) throw new D1ConflictError("Occurrence is not completed");
  return {
    occurredAt: row.corrected_occurred_at ?? row.occurred_at,
    performedByUserId: row.corrected_performed_by_user_id ?? row.performed_by_user_id,
  };
}

function undoStatements(
  db: D1Database,
  input: {
    actorId: string;
    householdId: string;
    idempotencyKey: string;
    nextOccurrenceId: string | null;
    occurrenceId: string;
  },
): D1PreparedStatement[] {
  const now = new Date().toISOString();
  const logId = crypto.randomUUID();
  const log = db.prepare(
    `INSERT INTO activity_logs (
      id, household_id, task_occurrence_id, action, actor_user_id,
      occurred_at, idempotency_key
    ) SELECT ?1, ?2, ?3, 'completion_undone', ?4, ?5, ?6
      WHERE EXISTS (
        SELECT 1 FROM task_occurrences
         WHERE id = ?3 AND household_id = ?2 AND status = 'completed'
      )
        AND (?7 IS NULL OR EXISTS (
          SELECT 1 FROM task_occurrences n
           WHERE n.id = ?7 AND n.household_id = ?2 AND n.status = 'pending'
             AND NOT EXISTS (
               SELECT 1 FROM activity_logs a
                WHERE a.task_occurrence_id = n.id AND a.household_id = ?2
             )
        ))`,
  ).bind(
    logId,
    input.householdId,
    input.occurrenceId,
    input.actorId,
    now,
    input.idempotencyKey,
    input.nextOccurrenceId,
  );
  const update = db.prepare(
    `UPDATE task_occurrences SET status = 'pending'
      WHERE id = ?1 AND household_id = ?2 AND status = 'completed'
        AND EXISTS (
          SELECT 1 FROM activity_logs WHERE id = ?3 AND household_id = ?2
        )`,
  ).bind(input.occurrenceId, input.householdId, logId);
  if (input.nextOccurrenceId === null) return [log, update];
  const removeNext = db.prepare(
    `DELETE FROM task_occurrences
      WHERE id = ?1 AND household_id = ?2 AND status = 'pending'
        AND EXISTS (
          SELECT 1 FROM activity_logs WHERE id = ?3 AND household_id = ?2
        )`,
  ).bind(input.nextOccurrenceId, input.householdId, logId);
  return [log, removeNext, update];
}

export async function undoTaskCompletion(
  db: D1Database,
  session: D1Session,
  occurrenceId: string,
  idempotencyKey: string,
): Promise<string> {
  const user = requireD1Session(session);
  const householdId = await requireCurrentHouseholdId(db, session);
  const replay = await db.prepare(
    `SELECT task_occurrence_id FROM activity_logs
      WHERE household_id = ?1 AND idempotency_key = ?2
        AND action = 'completion_undone'`,
  ).bind(householdId, idempotencyKey).first<{ task_occurrence_id: string }>();
  if (replay !== null) {
    if (replay.task_occurrence_id !== occurrenceId) {
      throw new D1ConflictError("Idempotency key was already used for a different occurrence");
    }
    return occurrenceId;
  }
  const occurrence = await loadOccurrence(db, householdId, occurrenceId);
  if (occurrence.status !== "completed") throw new D1ConflictError("Occurrence is not completed");
  const completion = await loadActiveCompletion(db, householdId, occurrenceId);
  const statements = undoStatements(db, {
    actorId: user.userId,
    householdId,
    idempotencyKey,
    nextOccurrenceId: completion.next_task_occurrence_id,
    occurrenceId,
  });
  let results: D1Result[];
  try {
    results = await db.batch(statements);
  } catch {
    if (completion.next_task_occurrence_id !== null) {
      throw new D1ConflictError("Next occurrence has been modified");
    }
    throw new D1ConflictError("Occurrence is not completed");
  }
  if ((results[0]?.meta.changes ?? 0) !== 1) {
    throw new D1ConflictError("Next occurrence has been modified");
  }
  return occurrenceId;
}

async function findCorrectionReplay(
  db: D1Database,
  householdId: string,
  idempotencyKey: string,
): Promise<{ task_occurrence_id: string } | null> {
  return db.prepare(
    `SELECT task_occurrence_id FROM completion_corrections
      WHERE household_id = ?1 AND idempotency_key = ?2`,
  ).bind(householdId, idempotencyKey).first();
}

// 冪等性キーの再送を検知する。同じOccurrenceへの再送ならtrueを返し(呼び出し側は
// 何もせず成功扱いにする)、別のOccurrenceへの使い回しは拒否する。
function isCorrectionReplay(
  replay: { task_occurrence_id: string } | null,
  occurrenceId: string,
): boolean {
  if (replay === null) return false;
  if (replay.task_occurrence_id !== occurrenceId) {
    throw new D1ConflictError("Idempotency key was already used for a different occurrence");
  }
  return true;
}

type CorrectOccurredAtInput = {
  actorId: string;
  completedActivityLogId: string;
  correctionId: string;
  householdId: string;
  idempotencyKey: string;
  newOccurredAt: string;
  next: ReturnType<typeof nextOccurrence>;
  nextOccurrenceId: string | null;
  occurrenceId: string;
  previousOccurredAt: string;
};

// 訂正行の挿入自体を、Occurrenceがまだcompletedであること・(再計算が必要なら)
// 次回Occurrenceが無操作のままpendingであることの両方をWHERE句へ埋め込んだ
// 条件付きINSERTにする(undoStatementsと同じ構造)。どちらか崩れていれば
// この文自体が0行のまま失敗し、後続のUPDATEも連動して不成立になる。
function insertOccurredAtCorrectionStatement(
  db: D1Database,
  input: CorrectOccurredAtInput,
): D1PreparedStatement {
  const requiredNextOccurrenceId = input.next === null ? null : input.nextOccurrenceId;
  return db.prepare(
    `INSERT INTO completion_corrections (
      id, household_id, task_occurrence_id, completed_activity_log_id, actor_user_id,
      idempotency_key, previous_occurred_at, new_occurred_at
    ) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
      WHERE EXISTS (
        SELECT 1 FROM task_occurrences
         WHERE id = ?3 AND household_id = ?2 AND status = 'completed'
      )
        AND (?9 IS NULL OR EXISTS (
          SELECT 1 FROM task_occurrences n
           WHERE n.id = ?9 AND n.household_id = ?2 AND n.status = 'pending'
             AND NOT EXISTS (
               SELECT 1 FROM activity_logs a
                WHERE a.task_occurrence_id = n.id AND a.household_id = ?2
             )
        ))`,
  ).bind(
    input.correctionId,
    input.householdId,
    input.occurrenceId,
    input.completedActivityLogId,
    input.actorId,
    input.idempotencyKey,
    input.previousOccurredAt,
    input.newOccurredAt,
    requiredNextOccurrenceId,
  );
}

function correctOccurredAtStatements(
  db: D1Database,
  input: CorrectOccurredAtInput,
): D1PreparedStatement[] {
  const statements = [insertOccurredAtCorrectionStatement(db, input)];
  if (input.next !== null && input.nextOccurrenceId !== null) {
    statements.push(db.prepare(
      `UPDATE task_occurrences SET scheduled_for = ?1, due_at = ?2
        WHERE id = ?3 AND household_id = ?4 AND status = 'pending'
          AND EXISTS (
            SELECT 1 FROM completion_corrections WHERE id = ?5 AND household_id = ?4
          )`,
    ).bind(
      input.next.scheduledFor,
      input.next.dueAt,
      input.nextOccurrenceId,
      input.householdId,
      input.correctionId,
    ));
  }
  return statements;
}

// #148: 完了済みOccurrenceの実施日時を訂正する。元のcompletedログは書き換えず、
// completion_correctionsへ追記する(案1、YDR-026)。完了日基準・定例日基準で
// 次回Occurrenceが自動生成されており、かつ一度も操作されていない場合だけ、
// 訂正と同じトランザクションでscheduled_for/due_atを再計算する
// (undoTaskCompletionと同じ「無操作の次回Occurrenceだけ」という条件)。
export async function correctCompletionOccurredAt(
  db: D1Database,
  session: D1Session,
  occurrenceId: string,
  idempotencyKey: string,
  newOccurredAt: string,
): Promise<void> {
  const user = requireD1Session(session);
  const householdId = await requireCurrentHouseholdId(db, session);
  if (isCorrectionReplay(await findCorrectionReplay(db, householdId, idempotencyKey), occurrenceId)) {
    return;
  }
  if (newOccurredAt > new Date().toISOString()) {
    throw new D1ConflictError("occurred_at must not be in the future");
  }
  const occurrence = await loadOccurrence(db, householdId, occurrenceId);
  if (occurrence.status !== "completed") throw new D1ConflictError("Occurrence is not completed");
  const completion = await loadActiveCompletion(db, householdId, occurrenceId);
  const effective = await resolveEffectiveCompletion(db, householdId, completion.id);

  const needsRecalc = occurrence.recurrence_basis !== "once" && completion.next_task_occurrence_id !== null;
  const next = needsRecalc ? nextOccurrence(occurrence, newOccurredAt) : null;

  const results = await runCompletionBatch(
    db,
    correctOccurredAtStatements(db, {
      actorId: user.userId,
      completedActivityLogId: completion.id,
      correctionId: crypto.randomUUID(),
      householdId,
      idempotencyKey,
      newOccurredAt,
      next,
      nextOccurrenceId: completion.next_task_occurrence_id,
      occurrenceId,
      previousOccurredAt: effective.occurredAt,
    }),
  );
  if ((results[0]?.meta.changes ?? 0) !== 1) {
    throw new D1ConflictError("Next occurrence has been modified");
  }
}

// #148: 完了済みOccurrenceの実施者を訂正する。実施者はスケジューリングに
// 影響しないため、次回Occurrenceの再計算は行わない(YDR-020)。
export async function correctCompletionPerformer(
  db: D1Database,
  session: D1Session,
  occurrenceId: string,
  idempotencyKey: string,
  newPerformerId: string,
): Promise<void> {
  const user = requireD1Session(session);
  const householdId = await requireCurrentHouseholdId(db, session);
  if (isCorrectionReplay(await findCorrectionReplay(db, householdId, idempotencyKey), occurrenceId)) {
    return;
  }
  const occurrence = await loadOccurrence(db, householdId, occurrenceId);
  if (occurrence.status !== "completed") throw new D1ConflictError("Occurrence is not completed");
  await requireHouseholdUser(db, householdId, newPerformerId, "Performer not found");
  const completion = await loadActiveCompletion(db, householdId, occurrenceId);
  const effective = await resolveEffectiveCompletion(db, householdId, completion.id);

  const results = await db.batch([
    db.prepare(
      `INSERT INTO completion_corrections (
        id, household_id, task_occurrence_id, completed_activity_log_id, actor_user_id,
        idempotency_key, previous_occurred_at, previous_performed_by_user_id, new_performed_by_user_id
      ) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
        WHERE EXISTS (
          SELECT 1 FROM task_occurrences
           WHERE id = ?3 AND household_id = ?2 AND status = 'completed'
        )`,
    ).bind(
      crypto.randomUUID(),
      householdId,
      occurrenceId,
      completion.id,
      user.userId,
      idempotencyKey,
      effective.occurredAt,
      effective.performedByUserId,
      newPerformerId,
    ),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1) {
    throw new D1ConflictError("Occurrence is not completed");
  }
}

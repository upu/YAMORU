import { requireCurrentHouseholdId, requireD1Session, type D1Session } from "../authorization";
import { D1ConflictError } from "../errors";
import { taskRuleSnapshotExpression } from "./rule-snapshot";
import { type OccurrenceWithRule, loadOccurrence, nextOccurrence, requireHouseholdUser } from "./shared";

// Todoの完了記録と完了取消。次回Occurrenceの作成と履歴の追記を原子的に行い、
// 同じidempotency_keyの再送は重複させない。

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

type CompletionStatementsInput = {
  actorId: string;
  householdId: string;
  idempotencyKey: string;
  next: ReturnType<typeof nextOccurrence>;
  occurredAt: string;
  occurrence: OccurrenceWithRule;
  performerId: string;
};

function nextOccurrenceStatement(
  db: D1Database,
  input: CompletionStatementsInput,
  logId: string,
): D1PreparedStatement | null {
  if (input.next === null) return null;
  const snapshot = taskRuleSnapshotExpression();
  return db.prepare(
    `INSERT INTO task_occurrences (
      id, household_id, task_rule_id, scheduled_for, due_at,
      completion_calendar_version, rule_snapshot
    ) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ${snapshot}
      FROM task_rules r
      LEFT JOIN managed_items i
        ON i.id = r.managed_item_id AND i.household_id = r.household_id
     WHERE r.id = ?3 AND r.household_id = ?2
       AND EXISTS (
        SELECT 1 FROM activity_logs WHERE id = ?7 AND household_id = ?2
      )`,
  ).bind(
    input.next.id,
    input.householdId,
    input.occurrence.task_rule_id,
    input.next.scheduledFor,
    input.next.dueAt,
    input.next.completionCalendarVersion,
    logId,
  );
}

function completionStatements(
  db: D1Database,
  input: CompletionStatementsInput,
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
  const next = nextOccurrenceStatement(db, input, logId);
  if (next !== null) statements.push(next);
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

export async function runCompletionBatch(
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

type ActiveCompletion = {
  id: string;
  next_task_occurrence_id: string | null;
};

// undoTaskCompletion・correctCompletionOccurredAt・correctCompletionPerformerが
// 共通で必要とする「このOccurrenceに対する現在有効なcompletedログ」を取得する。
// undo→再完了が起きていても、直近の1件だけを対象にする。
export async function loadActiveCompletion(
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
export async function resolveEffectiveCompletion(
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
             AND NOT EXISTS (
               SELECT 1 FROM task_rule_changes c
                WHERE c.task_occurrence_id = n.id AND c.household_id = ?2
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

import { requireCurrentHouseholdId, requireD1Session, type D1Session } from "../authorization";
import { D1ConflictError } from "../errors";
import { loadOccurrence, requireHouseholdUser } from "./shared";

// 担当予定者の変更・引き受けと、予定日の延期・設定。

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

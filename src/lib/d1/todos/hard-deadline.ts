import { requireCurrentHouseholdId, requireD1Session, type D1Session } from "../authorization";
import { D1ConflictError, D1NotFoundError } from "../errors";

export async function setTaskHardDeadline(
  db: D1Database, session: D1Session, occurrenceId: string,
  mustCompleteBy: string | null, expectedMustCompleteBy: string | null,
): Promise<void> {
  const actor = requireD1Session(session);
  const householdId = await requireCurrentHouseholdId(db, session);
  const row = await db.prepare("SELECT status,must_complete_by FROM task_occurrences WHERE id=? AND household_id=?")
    .bind(occurrenceId, householdId).first<{ status: string; must_complete_by: string | null }>();
  if (!row) throw new D1NotFoundError("Occurrence not found", "OCCURRENCE_NOT_FOUND");
  if (row.status !== "pending") throw new D1ConflictError("Occurrence is not pending", "OCCURRENCE_NOT_PENDING");
  if (row.must_complete_by !== expectedMustCompleteBy) throw new D1ConflictError("Hard deadline changed", "HARD_DEADLINE_CHANGED");
  if (mustCompleteBy === row.must_complete_by) return;
  const changeId = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(`INSERT INTO task_deadline_changes(id,household_id,task_occurrence_id,actor_user_id,previous_date,new_date)
      SELECT ?1,?2,?3,?4,must_complete_by,?5 FROM task_occurrences
      WHERE id=?3 AND household_id=?2 AND status='pending' AND must_complete_by IS ?6`)
      .bind(changeId, householdId, occurrenceId, actor.userId, mustCompleteBy, expectedMustCompleteBy),
    db.prepare(`UPDATE task_occurrences SET must_complete_by=?1 WHERE id=?2 AND household_id=?3
      AND EXISTS(SELECT 1 FROM task_deadline_changes WHERE id=?4 AND household_id=?3)`)
      .bind(mustCompleteBy, occurrenceId, householdId, changeId),
  ]);
  if (results[0].meta.changes === 0) throw new D1ConflictError("Hard deadline changed", "HARD_DEADLINE_CHANGED");
}

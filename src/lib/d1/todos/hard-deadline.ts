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
  const results = await db.batch(hardDeadlineStatements(db, {
    actorId: actor.userId, changeId: crypto.randomUUID(), expected: expectedMustCompleteBy, householdId, mustCompleteBy, occurrenceId,
  }));
  if (results[0].meta.changes === 0) throw new D1ConflictError("Hard deadline changed", "HARD_DEADLINE_CHANGED");
}

// 必達日の変更履歴と現在値。履歴は、pendingで必達日が想定どおり(expected)の
// ときだけ作り、現在値は履歴があるときだけ変える。外部command(#437)も同じ文を使い、
// 履歴へ操作キー(idempotencyKey、`<key>:deadline`)を残す。Webからの変更はnull。
export function hardDeadlineStatements(
  db: D1Database,
  input: {
    actorId: string; changeId: string; expected: string | null; householdId: string; idempotencyKey?: string | null;
    mustCompleteBy: string | null; occurrenceId: string;
  },
): D1PreparedStatement[] {
  const { changeId, householdId, occurrenceId } = input;
  return [
    db.prepare(`INSERT INTO task_deadline_changes(id,household_id,task_occurrence_id,actor_user_id,previous_date,new_date,idempotency_key)
      SELECT ?1,?2,?3,?4,must_complete_by,?5,?7 FROM task_occurrences
      WHERE id=?3 AND household_id=?2 AND status='pending' AND must_complete_by IS ?6`)
      .bind(changeId, householdId, occurrenceId, input.actorId, input.mustCompleteBy, input.expected,
        input.idempotencyKey === undefined || input.idempotencyKey === null ? null : `${input.idempotencyKey}:deadline`),
    db.prepare(`UPDATE task_occurrences SET must_complete_by=?1 WHERE id=?2 AND household_id=?3
      AND EXISTS(SELECT 1 FROM task_deadline_changes WHERE id=?4 AND household_id=?3)`)
      .bind(input.mustCompleteBy, occurrenceId, householdId, changeId),
  ];
}

import { requireCurrentHouseholdId, requireD1Session, type D1Session } from "../authorization";
import { D1ConflictError } from "../errors";
import { loadActiveCompletion, resolveEffectiveCompletion, runCompletionBatch } from "./completion";
import { loadOccurrence, nextOccurrence, requireHouseholdUser } from "./shared";

// 実施日時・実施者の訂正(YDR-026、Issue #148)。元のcompletedログは書き換えず、
// 訂正イベントを追記する。

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
    throw new D1ConflictError(
      "Idempotency key was already used for a different occurrence",
      "IDEMPOTENCY_KEY_REUSED",
    );
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

// 訂正行の挿入自体を、次の三つをWHERE句へ埋め込んだ条件付きINSERTにする
// (undoStatementsと同じ構造)。どれか崩れていればこの文自体が0行のまま失敗し、
// 後続のUPDATEも連動して不成立になる。
//
// 1. 対象Occurrenceがまだcompletedであること。
// 2. 次回Occurrenceのルールが編集されていないこと(?10)。YDR-039の3により、
//    TaskRule変更が記録された後の実施日訂正は方式によらず拒否する。編集済みの
//    次回を削除・再計算して利用者の変更を失わないための条件なので、日付を
//    再計算しない方式でも外さない。
// 3. 日付を再計算する場合だけ(?9が非NULL)、次回Occurrenceが無操作のまま
//    pendingであること。再計算は次回のscheduled_for/due_atを書き換えるため、
//    延期や担当変更が既に記録されている次回を黙って上書きしない。
//    「必要になったら繰り返す」(manual)の次回は日付を持たず再計算もしないので、
//    この条件は課さない(Issue #325 / YDR-046)。
function insertOccurredAtCorrectionStatement(
  db: D1Database,
  input: CorrectOccurredAtInput,
): D1PreparedStatement {
  const recalculatedNextOccurrenceId = input.next === null ? null : input.nextOccurrenceId;
  return db.prepare(
    `INSERT INTO completion_corrections (
      id, household_id, task_occurrence_id, completed_activity_log_id, actor_user_id,
      idempotency_key, previous_occurred_at, new_occurred_at
    ) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
      WHERE EXISTS (
        SELECT 1 FROM task_occurrences
         WHERE id = ?3 AND household_id = ?2 AND status = 'completed'
      )
        AND NOT EXISTS (
          SELECT 1 FROM task_rule_changes c
           WHERE c.task_occurrence_id = ?10 AND c.household_id = ?2
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
    recalculatedNextOccurrenceId,
    input.nextOccurrenceId,
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
    throw new D1ConflictError("occurred_at must not be in the future", "OCCURRED_AT_IN_FUTURE");
  }
  const occurrence = await loadOccurrence(db, householdId, occurrenceId);
  if (occurrence.status !== "completed") throw new D1ConflictError("Occurrence is not completed", "OCCURRENCE_NOT_COMPLETED");
  const completion = await loadActiveCompletion(db, householdId, occurrenceId);
  const effective = await resolveEffectiveCompletion(db, householdId, completion.id);

  // 次回Occurrenceの予定を実施日時から計算し直すのは、その次回が日付を持つ
  // 方式のときだけ。一回限りTodoはそもそも次回を作らず、「必要になったら
  // 繰り返す」(manual)の次回は日付を持たないため実施日時に依存しない
  // (Issue #325 / YDR-046)。再計算しないときは、「無操作の次回Occurrence」も
  // 求めない。求めてしまうと、次回の担当を決めた・名前を直しただけで、
  // 関係のない実施日の訂正まで拒否されてしまう。
  const recalculated = completion.next_task_occurrence_id === null
    ? null
    : nextOccurrence(occurrence, newOccurredAt);
  const next = recalculated !== null && recalculated.scheduledFor !== null
    ? recalculated
    : null;

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
    throw new D1ConflictError("Next occurrence has been modified", "NEXT_OCCURRENCE_MODIFIED");
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
  if (occurrence.status !== "completed") throw new D1ConflictError("Occurrence is not completed", "OCCURRENCE_NOT_COMPLETED");
  await requireHouseholdUser(db, householdId, newPerformerId, "PERFORMER_NOT_FOUND");
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
    throw new D1ConflictError("Occurrence is not completed", "OCCURRENCE_NOT_COMPLETED");
  }
}

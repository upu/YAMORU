import { requireCurrentHouseholdId, requireD1Session, type D1Session } from "../authorization";
import { D1ConflictError } from "../errors";
import { type OccurrenceWithRule, loadOccurrence, requireHouseholdUser, requireManagedItem } from "./shared";

// Todo詳細の取得と、繰り返しなしTodoの編集(Issue #203)。

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
  // 完了から推奨開始・推奨上限までの日数(Issue #244)。recurrence_basis='once'
  // /'calendar'では常に0(YDR-017、001_init.sqlのCHECK制約)。
  recommended_start_offset: number;
  recommended_until_offset: number;
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
  task_rule_id: string;
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
     SELECT o.id, o.task_rule_id, o.scheduled_for, o.due_at, o.assignee_user_id, o.status,
            r.title, r.recurrence_basis, r.deadline_kind,
            r.recommended_start_offset, r.recommended_until_offset,
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

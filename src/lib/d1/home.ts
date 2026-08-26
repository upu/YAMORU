import { requireCurrentHouseholdId, type D1Session } from "./authorization";

// Issue #223: Todo一覧の担当予定者(assignee_user_id)による絞り込み。
// 完了記録の実施者(performed_by_user_id、YDR-020)とは別の意味であり、
// 混同しないよう別の型・別のクエリー条件として扱う。
export type AssigneeFilter =
  | { type: "member"; userId: string }
  | { type: "unassigned" };

// household_idによる絞り込み(このファイルの各クエリー)がすでに家庭間分離を
// 保証しているため、ここでのuserIdは呼び出し元がhousehold外の値を渡しても
// 単に0件になるだけで安全である(情報は漏れない)。表示名の解決・値の妥当性
// 確認はUI側(呼び出し元)の責務とする。
function assigneeFilterParams(
  filter: AssigneeFilter | undefined,
): { unassignedOnly: number; userId: string | null } {
  if (filter === undefined) return { unassignedOnly: 0, userId: null };
  if (filter.type === "unassigned") return { unassignedOnly: 1, userId: null };
  return { unassignedOnly: 0, userId: filter.userId };
}

// Issue #225: Todo一覧のフリーワード検索。対象はTodo名(task_rules.title)
// だけとする(受け入れ基準、issue本文の設計メモ)。LIKEの特殊文字(%, _)は
// 検索語として入力されても、ワイルドカードではなく文字通りの部分文字列と
// して扱う(ESCAPE句で無害化)。SQLite標準のLOWER()はASCIIだけを小文字化
// するため、大文字・小文字の違いは英数字部分にだけ影響し、日本語部分は
// もともと大文字小文字の区別がないため挙動に影響しない。前後の空白・
// 空文字は絞り込みなしとして扱う。
function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function titleSearchPattern(search: string | undefined): string | null {
  if (search === undefined) return null;
  const trimmed = search.trim();
  if (trimmed === "") return null;
  return `%${escapeLikePattern(trimmed.toLocaleLowerCase("ja-JP"))}%`;
}

export type PendingOccurrenceRow = {
  assignee_user_id: string | null;
  due_at: string | null;
  id: string;
  scheduled_for: string | null;
  task_rules: {
    deadline_kind: string;
    managed_items: { id: string; name: string } | null;
    recurrence_basis: string;
    title: string;
  };
};

export type RecentCompletionRow = {
  activity_log_id: string;
  managed_item_id: string | null;
  managed_item_name: string | null;
  occurred_at: string;
  performed_by_user_id: string | null;
  task_occurrence_id: string;
  task_rule_title: string;
};

type FlatPendingRow = Omit<PendingOccurrenceRow, "task_rules"> & {
  deadline_kind: string;
  managed_item_id: string | null;
  managed_item_name: string | null;
  recurrence_basis: string;
  title: string;
};

export async function listPendingOccurrences(
  db: D1Database,
  session: D1Session,
  assigneeFilter?: AssigneeFilter,
  search?: string,
): Promise<PendingOccurrenceRow[]> {
  const householdId = await requireCurrentHouseholdId(db, session);
  const { userId, unassignedOnly } = assigneeFilterParams(assigneeFilter);
  const searchPattern = titleSearchPattern(search);
  const { results } = await db.prepare(
    `SELECT o.id, o.scheduled_for, o.due_at, o.assignee_user_id,
            r.title, r.deadline_kind, r.recurrence_basis,
            i.id AS managed_item_id, i.name AS managed_item_name
       FROM task_occurrences o
       JOIN task_rules r ON r.id = o.task_rule_id AND r.household_id = o.household_id
       LEFT JOIN managed_items i ON i.id = r.managed_item_id AND i.household_id = r.household_id
      WHERE o.household_id = ?1 AND o.status = 'pending'
        AND (
          (?2 IS NULL AND ?3 = 0)
          OR (?3 = 1 AND o.assignee_user_id IS NULL)
          OR o.assignee_user_id = ?2
        )
        AND (?4 IS NULL OR LOWER(r.title) LIKE ?4 ESCAPE '\\')`,
  ).bind(householdId, userId, unassignedOnly, searchPattern).all<FlatPendingRow>();
  return results.map((row) => ({
    assignee_user_id: row.assignee_user_id,
    due_at: row.due_at,
    id: row.id,
    scheduled_for: row.scheduled_for,
    task_rules: {
      deadline_kind: row.deadline_kind,
      managed_items: row.managed_item_id === null
        ? null
        : { id: row.managed_item_id, name: row.managed_item_name ?? "" },
      recurrence_basis: row.recurrence_basis,
      title: row.title,
    },
  }));
}

export async function listRecentActiveCompletions(
  db: D1Database,
  session: D1Session,
  limit: number,
  assigneeFilter?: AssigneeFilter,
  search?: string,
): Promise<RecentCompletionRow[]> {
  const householdId = await requireCurrentHouseholdId(db, session);
  const boundedLimit = Math.min(Math.max(limit, 0), 100);
  const { userId, unassignedOnly } = assigneeFilterParams(assigneeFilter);
  const searchPattern = titleSearchPattern(search);
  // #148: occurred_at・performed_by_user_idは、元のcompletedログの値ではなく、
  // completion_correctionsで訂正済みなら訂正後の有効値を返す(YDR-026)。
  // 日時訂正と実施者訂正は別行として記録されるため、それぞれ独立に最新の
  // 訂正を相関サブクエリで引き、なければ元の値へフォールバックする。
  // Issue #223: 絞り込みはOccurrenceの担当予定者(assignee_user_id)を対象と
  // し、この完了を実際に行った実施者(performed_by_user_id)は対象にしない。
  const { results } = await db.prepare(
    `WITH ranked AS (
       SELECT l.id, l.occurred_at, l.recorded_at, l.performed_by_user_id,
              l.task_occurrence_id, o.task_rule_id,
              row_number() OVER (
                PARTITION BY l.task_occurrence_id
                ORDER BY l.recorded_at DESC, l.id DESC
              ) AS position
         FROM activity_logs l
         JOIN task_occurrences o
           ON o.id = l.task_occurrence_id AND o.household_id = l.household_id
        WHERE l.household_id = ?1 AND l.action = 'completed'
          AND o.status = 'completed'
          AND (
            (?3 IS NULL AND ?4 = 0)
            OR (?4 = 1 AND o.assignee_user_id IS NULL)
            OR o.assignee_user_id = ?3
          )
     )
     SELECT ranked.id AS activity_log_id,
            coalesce(
              (SELECT c.new_occurred_at FROM completion_corrections c
                 WHERE c.completed_activity_log_id = ranked.id AND c.household_id = ?1
                   AND c.new_occurred_at IS NOT NULL
                 ORDER BY c.corrected_at DESC, c.id DESC LIMIT 1),
              ranked.occurred_at
            ) AS occurred_at,
            coalesce(
              (SELECT c.new_performed_by_user_id FROM completion_corrections c
                 WHERE c.completed_activity_log_id = ranked.id AND c.household_id = ?1
                   AND c.new_performed_by_user_id IS NOT NULL
                 ORDER BY c.corrected_at DESC, c.id DESC LIMIT 1),
              ranked.performed_by_user_id
            ) AS performed_by_user_id,
            ranked.task_occurrence_id,
            r.title AS task_rule_title, i.id AS managed_item_id,
            i.name AS managed_item_name
       FROM ranked
       JOIN task_rules r ON r.id = ranked.task_rule_id AND r.household_id = ?1
       LEFT JOIN managed_items i ON i.id = r.managed_item_id AND i.household_id = ?1
      WHERE ranked.position = 1
        AND (?5 IS NULL OR LOWER(r.title) LIKE ?5 ESCAPE '\\')
      ORDER BY ranked.occurred_at DESC, ranked.recorded_at DESC, ranked.id DESC
      LIMIT ?2`,
  ).bind(householdId, boundedLimit, userId, unassignedOnly, searchPattern).all<RecentCompletionRow>();
  return results;
}

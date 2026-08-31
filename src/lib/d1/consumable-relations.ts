import { requireCurrentHouseholdId, type D1Session } from "./authorization";
import type { ConsumableRelationOption, ConsumableTaskRuleOption } from "./consumables";
import { likeSearchPattern } from "./text-search";

// Issue #292: 消耗品フォームの関連付けを、全件チェックリストから「選択済みを
// 表示し、追加するときに検索して選ぶ」構成へ変える(issue本文の設計メモの案3)。
// 候補は入力に応じてサーバー側で検索し、1回の取得件数を上限で区切る。
// household_idの絞り込みが必ず先に効くため、他家庭の管理対象・Todoは候補にも
// 件数にも現れない。
export const CONSUMABLE_CANDIDATE_LIMIT = 20;

// 選択済みの管理対象を渡すと、その管理対象のTodoを候補の先頭へ寄せる。
// 上限を超える指定はSQLのINリストが際限なく伸びないよう切り捨てる
// (順位付けの手掛かりであり、候補の絞り込み条件ではない)。
const RELATED_MANAGED_ITEM_LIMIT = 20;

// 上限より1件多く取得し、余りが出たかどうかで「まだ候補がある」を判定する
// (総件数のCOUNTを別に数えない)。呼び出し側はhasMoreを画面の案内へ使う。
export type ConsumableCandidatePage<T> = {
  hasMore: boolean;
  items: T[];
};

function toPage<T>(results: T[]): ConsumableCandidatePage<T> {
  return {
    hasMore: results.length > CONSUMABLE_CANDIDATE_LIMIT,
    items: results.slice(0, CONSUMABLE_CANDIDATE_LIMIT),
  };
}

export async function searchConsumableManagedItemCandidates(
  db: D1Database,
  session: D1Session,
  search: string,
): Promise<ConsumableCandidatePage<ConsumableRelationOption>> {
  const householdId = await requireCurrentHouseholdId(db, session);
  const { results } = await db.prepare(
    `SELECT id, name
       FROM managed_items
      WHERE household_id = ?1
        AND (?2 IS NULL OR LOWER(name) LIKE ?2 ESCAPE '\\')
      ORDER BY name COLLATE NOCASE, id
      LIMIT ?3`,
  ).bind(householdId, likeSearchPattern(search), CONSUMABLE_CANDIDATE_LIMIT + 1)
    .all<ConsumableRelationOption>();
  return toPage(results);
}

function relatedManagedItemIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
    .slice(0, RELATED_MANAGED_ITEM_LIMIT);
}

// 選択済み管理対象のTodoを先頭へ寄せる、ORDER BYの先頭項。手掛かりがない
// 場合は項ごと省く(SQLiteはORDER BYの整数リテラルを列の序数として解釈する
// ため、定数0は置けない)。
function relatedFirstOrder(relatedIds: string[]): string {
  if (relatedIds.length === 0) return "";
  const placeholders = relatedIds.map((_, index) => `?${String(index + 4)}`).join(", ");
  return `CASE WHEN t.managed_item_id IN (${placeholders}) THEN 0 ELSE 1 END, `;
}

// Todoは同名が並びやすいため、関連する管理対象名でも検索できるようにする
// (候補の表示にも管理対象名を添える)。管理対象に紐づかないTodoは
// m.nameがNULLとなり、タイトル側の一致だけで候補に残る。
export async function searchConsumableTaskRuleCandidates(
  db: D1Database,
  session: D1Session,
  search: string,
  relatedIds: string[],
): Promise<ConsumableCandidatePage<ConsumableTaskRuleOption>> {
  const householdId = await requireCurrentHouseholdId(db, session);
  const related = relatedManagedItemIds(relatedIds);
  const { results } = await db.prepare(
    `SELECT t.id, t.title, m.name AS managedItemName
       FROM task_rules t
       LEFT JOIN managed_items m
         ON m.id = t.managed_item_id AND m.household_id = t.household_id
      WHERE t.household_id = ?1
        AND t.deadline_kind = 'maintenance'
        AND (?2 IS NULL
             OR LOWER(t.title) LIKE ?2 ESCAPE '\\'
             OR LOWER(m.name) LIKE ?2 ESCAPE '\\')
      ORDER BY ${relatedFirstOrder(related)}t.title COLLATE NOCASE, t.id
      LIMIT ?3`,
  ).bind(householdId, likeSearchPattern(search), CONSUMABLE_CANDIDATE_LIMIT + 1, ...related)
    .all<ConsumableTaskRuleOption>();
  return toPage(results);
}

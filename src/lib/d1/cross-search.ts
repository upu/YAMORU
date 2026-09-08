import { requireCurrentHouseholdId, type D1Session } from "./authorization";
import type { ConsumableSummary } from "./consumables";
import { MANAGED_ITEM_CLASSIFICATION_SELECT } from "./managed-items";
import { likeSearchPattern } from "./text-search";

// Issue #349 / YDR-042: YAMORU全体をまたぐ横断検索のサーバー側の取得処理。
// 画面内検索(Todo一覧・台帳)が「いま開いている一覧を絞り込む」のに対し、
// ここは「画面を選ばず名前から対象へ到達する」ための取得であり、条件は
// 検索語だけを持つ。担当・状態・大分類などの絞り込みは画面内検索の役割
// として残す。
//
// 一致するのは常に「利用者が画面で見る名前」だけとする。何に一致したかを
// 結果行で説明できないまま対象を広げないため、関連する管理対象名・詳しい
// 種類・メモ・型番は検索しない(YDR-042の初期対象)。

// 種類ごとの上限。総件数のCOUNT(*)は数えず、上限より1件多く取得して
// 21件目が返ったかどうかで「まだ結果がある」を判定する(#292のConsumable
// 候補検索と同じ考え方)。1回の検索でD1から読む行数は3種類 × 21件に固定
// されるため、家庭内の対象が増えても取得量が上振れしない。
export const CROSS_SEARCH_LIMIT = 20;

export type CrossSearchTodo = {
  dueAt: string | null;
  // Todo詳細(/todos/[id])はTaskOccurrenceのIDで開くため、到達先もOccurrenceを指す。
  id: string;
  // 完了後に関連する管理対象の表示も更新するため、現在回のsnapshotに残る関連先を返す。
  managedItemId: string | null;
  scheduledFor: string | null;
  title: string;
};

export type CrossSearchManagedItem = {
  id: string;
  itemTypeLabel: string | null;
  kindCode: string;
  kindLabel: string;
  name: string;
};

export type CrossSearchConsumable = ConsumableSummary;

export type CrossSearchSection<T> = {
  hasMore: boolean;
  items: T[];
};

export type CrossSearchResults = {
  consumables: CrossSearchSection<CrossSearchConsumable>;
  managedItems: CrossSearchSection<CrossSearchManagedItem>;
  todos: CrossSearchSection<CrossSearchTodo>;
};

function toSection<T>(results: T[]): CrossSearchSection<T> {
  return {
    hasMore: results.length > CROSS_SEARCH_LIMIT,
    items: results.slice(0, CROSS_SEARCH_LIMIT),
  };
}

function emptyResults(): CrossSearchResults {
  return {
    consumables: { hasMore: false, items: [] },
    managedItems: { hasMore: false, items: [] },
    todos: { hasMore: false, items: [] },
  };
}

// YDR-039以降、Occurrenceは発生時のTaskRuleの値をrule_snapshotへ持ち、Todo一覧・
// Todo詳細はsnapshotがあればそちらを表示する。検索も同じ式で一致を判定しないと、
// 「次回以降」だけ名前を変えたTodoで、表示名に検索語が含まれない行が結果へ出る。
// 一致した名前をそのまま返すため、絞り込みと選択の双方で同じ式を使う。
const EFFECTIVE_TODO_TITLE = `CASE WHEN json_type(o.rule_snapshot, '$.title') IS NULL
        THEN r.title ELSE json_extract(o.rule_snapshot, '$.title') END`;
const EFFECTIVE_TODO_MANAGED_ITEM_ID = `CASE
        WHEN json_type(o.rule_snapshot, '$.managedItemId') IS NULL THEN r.managed_item_id
        ELSE json_extract(o.rule_snapshot, '$.managedItemId') END`;

// 未完了のOccurrenceだけを対象にする。実施済みは件数が増え続け、「探して到達
// する」操作ではなく「履歴を探す」操作になるため、初期対象へ含めない(YDR-042)。
// 予定日未定のOccurrence(YDR-030)は名前で探せる必要があるので結果へ含め、
// 並びでは日付のあるものの後ろへ置く。
const TODO_SEARCH_SQL = `SELECT o.id,
            ${EFFECTIVE_TODO_TITLE} AS title,
            ${EFFECTIVE_TODO_MANAGED_ITEM_ID} AS managedItemId,
            o.scheduled_for AS scheduledFor,
            o.due_at AS dueAt
       FROM task_occurrences o
       JOIN task_rules r ON r.id = o.task_rule_id AND r.household_id = o.household_id
      WHERE o.household_id = ?1 AND o.status = 'pending'
        AND LOWER(${EFFECTIVE_TODO_TITLE}) LIKE ?2 ESCAPE '\\'
      ORDER BY title COLLATE NOCASE, scheduledFor IS NULL, scheduledFor, o.id
      LIMIT ?3`;

// 種類ごとの並びは名前順で揃える。上限で切るのは並びの先頭からなので、
// 台帳一覧(登録の新しい順)と違い、同じ検索語なら常に同じ行が残る。
const MANAGED_ITEM_SEARCH_SQL = `SELECT item.id, item.name, item.kindCode, item.kindLabel, item.itemTypeLabel
       FROM (${MANAGED_ITEM_CLASSIFICATION_SELECT}
              WHERE m.household_id = ?1) item
      WHERE LOWER(item.name) LIKE ?2 ESCAPE '\\'
      ORDER BY item.name COLLATE NOCASE, item.id
      LIMIT ?3`;

const CONSUMABLE_SEARCH_SQL = `SELECT id, name, stock_status AS stockStatus
       FROM consumables
      WHERE household_id = ?1
        AND LOWER(name) LIKE ?2 ESCAPE '\\'
      ORDER BY name COLLATE NOCASE, id
      LIMIT ?3`;

// 3種類とも認証済み利用者の家庭を先に確定し、各クエリーの最初の条件を
// household_idにする。結果・件数・「まだ結果がある」の判定のすべてが家庭内の
// 行だけで決まるため、他家庭の対象は検索語が一致しても現れない。
export async function searchAcrossHousehold(
  db: D1Database,
  session: D1Session,
  search: string,
): Promise<CrossSearchResults> {
  // 空文字・空白だけの検索語は「絞り込みなし」として全件を返さない。
  // 呼び出し側は0件ではなく入力待ちとして扱う。
  const searchPattern = likeSearchPattern(search);
  if (searchPattern === null) return emptyResults();

  const householdId = await requireCurrentHouseholdId(db, session);
  const limit = CROSS_SEARCH_LIMIT + 1;
  const [todos, managedItems, consumables] = await Promise.all([
    db.prepare(TODO_SEARCH_SQL).bind(householdId, searchPattern, limit).all<CrossSearchTodo>(),
    db.prepare(MANAGED_ITEM_SEARCH_SQL).bind(householdId, searchPattern, limit)
      .all<CrossSearchManagedItem>(),
    db.prepare(CONSUMABLE_SEARCH_SQL).bind(householdId, searchPattern, limit)
      .all<CrossSearchConsumable>(),
  ]);

  return {
    consumables: toSection(consumables.results),
    managedItems: toSection(managedItems.results),
    todos: toSection(todos.results),
  };
}

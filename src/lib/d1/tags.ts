import { getCurrentHouseholdId, requireHouseholdMembership, type D1Session } from "./authorization";
import { MANAGED_ITEM_TAG_MAX_COUNT, tagNameKey } from "../managed-items/tag-rules";
import { D1Error, D1NotFoundError } from "./errors";

// Issue #226 / YDR-048: ManagedItemへ付ける、大分類・詳しい種類とは独立した
// 横断的な文脈のタグ。タグは家庭単位のマスタ(tags)で、ManagedItemとの関連は
// managed_item_tagsが持つ。どちらもhousehold_idで先に絞り、他家庭のタグは
// 候補にも表示にも現れない。
export type Tag = { id: string; name: string };

// 登録・編集フォームから受け取るタグの指定。tagIdsは既存タグの選択、
// newTagNamesはその場で作るタグの名前(同じ家庭に同名のタグがあれば、
// 作らずにそのタグを付ける)。どちらも空なら「タグなし」を表す。
export type ManagedItemTagInput = {
  newTagNames: string[];
  tagIds: string[];
};

async function requireCurrentHousehold(db: D1Database, session: D1Session): Promise<string> {
  const householdId = await getCurrentHouseholdId(db, session);
  if (householdId === null) throw new D1NotFoundError("家庭が見つかりません。");
  await requireHouseholdMembership(db, session, householdId);
  return householdId;
}

// 登録・編集フォームの選択肢に出す、家庭内のタグ全件。
export async function listHouseholdTags(
  db: D1Database,
  session: D1Session,
): Promise<Tag[]> {
  const householdId = await requireCurrentHousehold(db, session);
  const { results } = await db.prepare(
    "SELECT id, name FROM tags WHERE household_id = ?1 ORDER BY name, id",
  ).bind(householdId).all<Tag>();
  return results;
}

const MANAGED_ITEM_TAGS_SELECT = `SELECT mt.managed_item_id AS managedItemId, t.id, t.name
  FROM managed_item_tags mt
  JOIN tags t ON t.id = mt.tag_id AND t.household_id = mt.household_id
 WHERE mt.household_id = ?1`;

// 台帳一覧で各ManagedItemの付与済みタグを並べるため、家庭内の関連を
// ManagedItemのIDごとにまとめて返す。一覧の件数ぶん問い合わせを繰り返さない。
export async function listManagedItemTagsByItem(
  db: D1Database,
  session: D1Session,
): Promise<Map<string, Tag[]>> {
  const householdId = await requireCurrentHousehold(db, session);
  const { results } = await db.prepare(
    `${MANAGED_ITEM_TAGS_SELECT} ORDER BY t.name, t.id`,
  ).bind(householdId).all<Tag & { managedItemId: string }>();
  const tagsByItem = new Map<string, Tag[]>();
  for (const { id, managedItemId, name } of results) {
    const current = tagsByItem.get(managedItemId) ?? [];
    current.push({ id, name });
    tagsByItem.set(managedItemId, current);
  }
  return tagsByItem;
}

// 詳細・編集画面で、一つのManagedItemに付いているタグを返す。他家庭の
// ManagedItemのIDを渡されても、household_idで絞るため空になる。
export async function listTagsForManagedItem(
  db: D1Database,
  session: D1Session,
  managedItemId: string,
): Promise<Tag[]> {
  const householdId = await requireCurrentHousehold(db, session);
  const { results } = await db.prepare(
    `${MANAGED_ITEM_TAGS_SELECT} AND mt.managed_item_id = ?2 ORDER BY t.name, t.id`,
  ).bind(householdId, managedItemId).all<Tag & { managedItemId: string }>();
  return results.map(({ id, name }) => ({ id, name }));
}

// 付け替え後のタグ数が上限を超えないことを、batchの前に確かめる。新しいタグの
// 名前は同じ家庭の既存タグ(選択済みのものを含む)へまとまるため、既存タグと
// 突き合わせてから数える。他家庭のタグIDはここでは数えず、batchの複合外部キー
// 違反として全体を取り消す。
export async function assertManagedItemTagLimit(
  db: D1Database,
  householdId: string,
  input: ManagedItemTagInput,
): Promise<void> {
  const { results } = await db.prepare(
    `SELECT id, name FROM tags
      WHERE household_id = ?1
        AND (id IN (SELECT value FROM json_each(?2))
          OR name IN (SELECT value FROM json_each(?3)))`,
  ).bind(householdId, JSON.stringify(input.tagIds), JSON.stringify(input.newTagNames)).all<Tag>();
  const existingKeys = new Set(results.map(({ name }) => tagNameKey(name)));
  const created = new Set(
    input.newTagNames.map(tagNameKey).filter((key) => !existingKeys.has(key)),
  );
  if (results.length + created.size > MANAGED_ITEM_TAG_MAX_COUNT) {
    throw new D1Error("Too many tags for a managed item", "MANAGED_ITEM_TAG_LIMIT_EXCEEDED");
  }
}

const MANAGED_ITEM_EXISTS =
  "EXISTS (SELECT 1 FROM managed_items WHERE id = ?2 AND household_id = ?1)";

// ManagedItemの登録・編集と同じdb.batch()へ入れる、タグの付け替え。既存の
// 関連を消してから指定どおりに付け直すことで、追加・解除・変更を同じ経路で
// 扱う(external_linksの付け替えと同じ方式)。
//
// - どの文も、対象のManagedItemが自家庭に存在するときだけ行を書く。編集で
//   対象が見つからない場合は何も残さない(呼び出し元がNot Foundにする)。
// - 既存タグの選択(tagIds)は、managed_item_tagsの(tag_id, household_id)
//   複合外部キーが自家庭のタグであることを保証する。他家庭のタグIDを渡すと
//   制約違反でbatch全体が取り消される。
// - 新しいタグの名前は、同じ家庭に同名(英字の大文字小文字は区別しない)の
//   タグがあれば作らずにそのタグを付ける。
export function buildManagedItemTagStatements(
  db: D1Database,
  householdId: string,
  managedItemId: string,
  input: ManagedItemTagInput,
): D1PreparedStatement[] {
  const statements = [db.prepare(
    "DELETE FROM managed_item_tags WHERE managed_item_id = ?2 AND household_id = ?1",
  ).bind(householdId, managedItemId)];
  for (const tagId of input.tagIds) {
    statements.push(db.prepare(
      `INSERT INTO managed_item_tags (household_id, managed_item_id, tag_id)
       SELECT ?1, ?2, ?3 WHERE ${MANAGED_ITEM_EXISTS}
       ON CONFLICT(managed_item_id, tag_id) DO NOTHING`,
    ).bind(householdId, managedItemId, tagId));
  }
  for (const name of input.newTagNames) {
    statements.push(
      db.prepare(
        `INSERT INTO tags (id, household_id, name)
         SELECT ?3, ?1, ?4 WHERE ${MANAGED_ITEM_EXISTS}
         ON CONFLICT(household_id, name) DO NOTHING`,
      ).bind(householdId, managedItemId, crypto.randomUUID(), name),
      db.prepare(
        `INSERT INTO managed_item_tags (household_id, managed_item_id, tag_id)
         SELECT ?1, ?2, t.id FROM tags t
          WHERE t.household_id = ?1 AND t.name = ?3 AND ${MANAGED_ITEM_EXISTS}
         ON CONFLICT(managed_item_id, tag_id) DO NOTHING`,
      ).bind(householdId, managedItemId, name),
    );
  }
  return statements;
}

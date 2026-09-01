import { getCurrentHouseholdId, requireHouseholdMembership, type D1Session } from "./authorization";
import { D1NotFoundError } from "./errors";
import { likeSearchPattern } from "./text-search";

// Issue #218: 台帳一覧の検索・絞り込み。大分類(kindCode)・詳しい種類
// (itemTypeCode)は既存の分類候補(listManagedItemClassificationOptions)の
// コード値と一致するものだけを絞り込み条件にする(利用者向けラベルと
// データモデルを混同しない、issue本文の設計メモ)。
// Issue #238: 自由入力した詳しい種類(itemTypeCode未設定)も、家庭内で実際に
// 使われている表記(customItemType、大文字小文字・前後の空白を無視して比較)
// で絞り込めるようにする。itemTypeCodeとcustomItemTypeは同時に渡されても
// エラーにはせず、両方の条件をANDで適用する(利用者向けUIは常にどちらか
// 一方だけを渡す)。
export type ManagedItemFilter = {
  customItemType?: string;
  itemTypeCode?: string;
  kindCode?: string;
  search?: string;
};

export type ManagedItemClassificationOptions = {
  itemTypes: { code: string; kindCode: string; label: string }[];
  kinds: { code: string; label: string }[];
};
// Issue #238: 台帳一覧の絞り込み候補に出す、家庭内で実際に使われている
// 自由入力の詳しい種類。プリセット(managed_item_type_presets)とは別に、
// 大文字小文字・前後の空白を無視して家庭内・大分類ごとに一意化した表記を返す。
export type ManagedItemCustomTypeOption = { kindCode: string; label: string };
type ManagedItemClassificationInput = {
  customItemType: string | null;
  itemTypeCode: string | null;
  kindCode: string;
};
export type ManagedItemSummary = {
  id: string;
  itemTypeCode: string | null;
  itemTypeLabel: string | null;
  kindCode: string;
  kindLabel: string;
  name: string;
};
export type ActivityLogRow = {
  action: string;
  id: string;
  occurred_at: string;
  performed_by_user_id: string | null;
  recorded_at: string;
};
export type TaskOccurrenceRow = {
  activity_logs: ActivityLogRow[];
  assignee_user_id: string | null;
  due_at: string | null;
  id: string;
  scheduled_for: string | null;
  status: string;
  title_snapshot?: string;
};
export type TaskRuleRow = {
  deadline_kind: string;
  id: string;
  recurrence_basis: string;
  task_occurrences: TaskOccurrenceRow[];
  title: string;
};
// Issue #42: 家庭内での呼び名(name)とは別に残す任意の記録。いずれも未設定を許す。
// startedOnは「対象との関係が始まった時期」を表す中立的な値で、大分類に
// よらず同じ意味を持つ(Issue #239, YDR-033)。画面ラベルだけが大分類に応じて
// 変わる。
export type ManagedItemOptionalAttributes = {
  note: string | null;
  productInfo: string | null;
  startedOn: string | null;
};
export type ManagedItemDetailRow = ManagedItemSummary
  & ManagedItemOptionalAttributes
  & {
    external_links: { id: string; url: string }[];
    household_id: string;
    task_rules: TaskRuleRow[];
  };

export const OPTIONAL_ATTRIBUTE_SELECT =
  "m.note, m.product_info AS productInfo, m.started_on AS startedOn";

type ClassificationDefinition = { legacyKind: string };

export const MANAGED_ITEM_CLASSIFICATION_SELECT = `
  SELECT m.id,
         m.name,
         coalesce(current_kind.code, legacy_kind.code) AS kindCode,
         coalesce(current_kind.label, legacy_kind.label) AS kindLabel,
         CASE WHEN current_kind.code IS NULL THEN legacy_type.code ELSE c.item_type_code END AS itemTypeCode,
         CASE
           WHEN current_kind.code IS NULL THEN legacy_type.label
           ELSE coalesce(c.custom_item_type, current_type.label)
         END AS itemTypeLabel
    FROM managed_items m
    LEFT JOIN managed_item_classifications c
      ON c.managed_item_id = m.id AND c.household_id = m.household_id
    LEFT JOIN managed_item_kinds current_kind
      ON current_kind.code = c.kind_code
     AND m.kind = coalesce(
       (SELECT p.legacy_kind FROM managed_item_type_presets p
         WHERE p.code = c.item_type_code AND p.kind_code = c.kind_code),
       current_kind.legacy_kind
     )
    LEFT JOIN managed_item_type_presets current_type
      ON current_type.code = c.item_type_code AND current_type.kind_code = c.kind_code
    JOIN managed_item_type_presets legacy_type ON legacy_type.code = m.kind
    JOIN managed_item_kinds legacy_kind ON legacy_kind.code = legacy_type.kind_code`;

async function requireCurrentHousehold(db: D1Database, session: D1Session): Promise<string> {
  const householdId = await getCurrentHouseholdId(db, session);
  if (householdId === null) throw new D1NotFoundError("家庭が見つかりません。");
  await requireHouseholdMembership(db, session, householdId);
  return householdId;
}
// Issue #218: 家庭内の管理対象を、任意で名前検索・大分類・詳しい種類の
// 各条件を組み合わせて絞り込む。household_idによる絞り込み(サブクエリの
// WHERE句)が先に効くため、他家庭の管理対象は検索候補・結果のどちらにも
// 現れない。フィルターを何も渡さない既存呼び出しは、これまでどおり全件を
// 返す。
export async function listManagedItems(
  db: D1Database,
  session: D1Session,
  filter?: ManagedItemFilter,
): Promise<ManagedItemSummary[]> {
  const householdId = await requireCurrentHousehold(db, session);
  const kindCode = filter?.kindCode ?? null;
  const itemTypeCode = filter?.itemTypeCode ?? null;
  const customItemType = filter?.customItemType?.trim() ?? null;
  const searchPattern = likeSearchPattern(filter?.search);
  // MANAGED_ITEM_CLASSIFICATION_SELECT自体にはcreated_atを含めない(他の
  // 呼び出し元(getManagedItem等)の公開する行の形へ意図せず漏らさないため)。
  // 並び替えのためだけにmanaged_itemsへ結合し直す(getManagedItemForEdit等と
  // 同じ「サブクエリを結合し直す」パターン)。
  // Issue #238: 自由入力の詳しい種類は、プリセットに解決されなかった
  // (item.itemTypeCode IS NULL)行のitemTypeLabel(custom_item_typeそのもの)を
  // LOWER(TRIM())で比較して絞り込む。プリセット一致(?3)と自由入力一致(?5)は
  // 独立した条件としてANDで組み合わせる。
  const { results } = await db.prepare(
    `SELECT item.id, item.name, item.kindCode, item.kindLabel,
            item.itemTypeCode, item.itemTypeLabel
       FROM (${MANAGED_ITEM_CLASSIFICATION_SELECT}
              WHERE m.household_id = ?1) item
       JOIN managed_items m ON m.id = item.id
      WHERE (?2 IS NULL OR item.kindCode = ?2)
        AND (?3 IS NULL OR item.itemTypeCode = ?3)
        AND (?4 IS NULL OR LOWER(item.name) LIKE ?4 ESCAPE '\\')
        AND (?5 IS NULL OR (
              item.itemTypeCode IS NULL AND LOWER(TRIM(item.itemTypeLabel)) = LOWER(TRIM(?5))
            ))
      ORDER BY m.created_at DESC, m.id DESC`,
  ).bind(householdId, kindCode, itemTypeCode, searchPattern, customItemType).all<ManagedItemSummary>();
  return results;
}

export async function listManagedItemClassificationOptions(
  db: D1Database,
): Promise<ManagedItemClassificationOptions> {
  const [kinds, itemTypes] = await Promise.all([
    db.prepare("SELECT code, label FROM managed_item_kinds WHERE is_active = 1 ORDER BY sort_order, code")
      .all<{ code: string; label: string }>(),
    db.prepare(`SELECT p.code, p.kind_code AS kindCode, p.label
                  FROM managed_item_type_presets p
                  JOIN managed_item_kinds k ON k.code = p.kind_code AND k.is_active = 1
                 WHERE p.is_active = 1
                 ORDER BY p.kind_code, p.sort_order, p.code`)
      .all<{ code: string; kindCode: string; label: string }>(),
  ]);
  return { itemTypes: itemTypes.results, kinds: kinds.results };
}

// Issue #238: household内で実際に使われている自由入力の詳しい種類を、絞り込み
// 候補として返す。listManagedItemsが絞り込みに使うのと同じ解決結果
// (MANAGED_ITEM_CLASSIFICATION_SELECT、旧kindからの読み替えを含む)を使うため、
// ここに現れる候補は必ずlistManagedItemsのcustomItemType条件で1件以上へ一致する。
// 大文字小文字・前後の空白だけが違う表記は家庭・大分類ごとに1件へまとめ、
// 代表表記(MIN()で決まる1件)をlabelとして返す。他家庭の自由入力値は
// household_idで絞り込むため混ざらない。
export async function listHouseholdCustomItemTypes(
  db: D1Database,
  session: D1Session,
): Promise<ManagedItemCustomTypeOption[]> {
  const householdId = await requireCurrentHousehold(db, session);
  const { results } = await db.prepare(
    `SELECT item.kindCode, MIN(TRIM(item.itemTypeLabel)) AS label
       FROM (${MANAGED_ITEM_CLASSIFICATION_SELECT}
              WHERE m.household_id = ?1) item
      WHERE item.itemTypeCode IS NULL AND item.itemTypeLabel IS NOT NULL
      GROUP BY item.kindCode, LOWER(TRIM(item.itemTypeLabel))
      ORDER BY item.kindCode, label`,
  ).bind(householdId).all<ManagedItemCustomTypeOption>();
  return results;
}

async function requireActiveClassification(
  db: D1Database,
  input: ManagedItemClassificationInput,
): Promise<ClassificationDefinition> {
  if (input.itemTypeCode !== null && input.customItemType !== null) {
    throw new Error("管理対象の分類を選択し直してください。");
  }
  const definition = await db.prepare(
    `SELECT coalesce(p.legacy_kind, k.legacy_kind) AS legacyKind
       FROM managed_item_kinds k
       LEFT JOIN managed_item_type_presets p
         ON p.code = ?2 AND p.kind_code = k.code AND p.is_active = 1
      WHERE k.code = ?1 AND k.is_active = 1
        AND (?2 IS NULL OR p.code IS NOT NULL)`,
  ).bind(input.kindCode, input.itemTypeCode).first<ClassificationDefinition>();
  if (definition === null) {
    throw new Error("管理対象の分類を選択し直してください。");
  }
  return definition;
}

type ManagedItemWriteInput = ManagedItemClassificationInput
  & ManagedItemOptionalAttributes
  & {
    externalUrl: string | null;
    name: string;
  };

export async function createManagedItem(
  db: D1Database,
  session: D1Session,
  input: ManagedItemWriteInput,
): Promise<string> {
  const householdId = await requireCurrentHousehold(db, session);
  const classification = await requireActiveClassification(db, input);
  const itemId = crypto.randomUUID();
  const statements = [db.prepare(`INSERT INTO managed_items (
      id, household_id, name, kind, note, product_info, started_on
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
    .bind(
      itemId,
      householdId,
      input.name,
      classification.legacyKind,
      input.note,
      input.productInfo,
      input.startedOn,
    ),
  db.prepare(`INSERT INTO managed_item_classifications (
      managed_item_id, household_id, kind_code, item_type_code, custom_item_type
    ) VALUES (?1, ?2, ?3, ?4, ?5)`)
    .bind(itemId, householdId, input.kindCode, input.itemTypeCode, input.customItemType)];
  if (input.externalUrl !== null) statements.push(db.prepare("INSERT INTO external_links (id, household_id, managed_item_id, url) VALUES (?1, ?2, ?3, ?4)")
    .bind(crypto.randomUUID(), householdId, itemId, input.externalUrl));
  await db.batch(statements);
  return itemId;
}

export async function getManagedItem(db: D1Database, session: D1Session, id: string): Promise<ManagedItemSummary | null> {
  const householdId = await requireCurrentHousehold(db, session);
  return db.prepare(`${MANAGED_ITEM_CLASSIFICATION_SELECT}
      WHERE m.id = ?1 AND m.household_id = ?2`)
    .bind(id, householdId).first<ManagedItemSummary>();
}

export type ManagedItemEditData = ManagedItemSummary
  & ManagedItemOptionalAttributes
  & {
    customItemType: string | null;
    externalUrl: string | null;
  };

// Issue #40の編集画面が使う。外部リンクは登録時と同じく高々1件を想定するが、
// 複数行が存在する場合でもcreated_atの昇順で1件だけを既定値として返す。
export async function getManagedItemForEdit(
  db: D1Database,
  session: D1Session,
  id: string,
): Promise<ManagedItemEditData | null> {
  const householdId = await requireCurrentHousehold(db, session);
  return db.prepare(
    `SELECT item.*,
            ${OPTIONAL_ATTRIBUTE_SELECT},
            CASE
              WHEN m.kind = coalesce(current_type.legacy_kind, current_kind.legacy_kind)
                THEN c.custom_item_type
              ELSE NULL
            END AS customItemType,
            l.url AS externalUrl
       FROM (${MANAGED_ITEM_CLASSIFICATION_SELECT}
              WHERE m.id = ?1 AND m.household_id = ?2) item
       JOIN managed_items m ON m.id = item.id
       LEFT JOIN managed_item_classifications c
         ON c.managed_item_id = m.id AND c.household_id = m.household_id
       LEFT JOIN managed_item_kinds current_kind ON current_kind.code = c.kind_code
       LEFT JOIN managed_item_type_presets current_type
         ON current_type.code = c.item_type_code AND current_type.kind_code = c.kind_code
       LEFT JOIN external_links l
         ON l.managed_item_id = m.id AND l.household_id = m.household_id
      ORDER BY l.created_at LIMIT 1`,
  ).bind(id, householdId).first<ManagedItemEditData>();
}

// Issue #40: 名前・種類・外部リンクをD1側の家庭境界とトランザクションで
// 一括更新する(YDR-022、クライアントからhousehold_idを受け取らない)。
// Issue #42のメモ・商品情報・開始時期(Issue #239でstarted_onへ移行、YDR-033)は
// 名前と同じ行にあるため、同じUPDATE一文で更新される(未設定化はNULLの
// 書き込みで表す)。
// 外部リンクは既存行を消してから(未設定ならそのまま、設定ありなら)1件だけ
// 挿入し直すことで、追加・変更・未設定化のいずれも同じ経路で扱う。
// createManagedItemと同じくdb.batch()で一括実行し、対象が自家庭に無ければ
// (Not Found)部分更新を残さない。
export async function updateManagedItem(
  db: D1Database,
  session: D1Session,
  id: string,
  input: ManagedItemWriteInput,
): Promise<void> {
  const householdId = await requireCurrentHousehold(db, session);
  const classification = await requireActiveClassification(db, input);
  const statements = [
    db.prepare(
      `UPDATE managed_items
          SET name = ?1, kind = ?2, note = ?5, product_info = ?6, started_on = ?7
        WHERE id = ?3 AND household_id = ?4`,
    ).bind(
      input.name,
      classification.legacyKind,
      id,
      householdId,
      input.note,
      input.productInfo,
      input.startedOn,
    ),
    db.prepare(
      `INSERT INTO managed_item_classifications (
         managed_item_id, household_id, kind_code, item_type_code, custom_item_type
       )
       SELECT ?1, ?2, ?3, ?4, ?5
        WHERE EXISTS (
          SELECT 1 FROM managed_items WHERE id = ?1 AND household_id = ?2
        )
       ON CONFLICT(managed_item_id) DO UPDATE SET
         kind_code = excluded.kind_code,
         item_type_code = excluded.item_type_code,
         custom_item_type = excluded.custom_item_type`,
    ).bind(id, householdId, input.kindCode, input.itemTypeCode, input.customItemType),
    db.prepare(
      "DELETE FROM external_links WHERE managed_item_id = ?1 AND household_id = ?2",
    ).bind(id, householdId),
  ];
  if (input.externalUrl !== null) {
    statements.push(db.prepare(
      `INSERT INTO external_links (id, household_id, managed_item_id, url)
        SELECT ?1, ?2, ?3, ?4
        WHERE EXISTS (SELECT 1 FROM managed_items WHERE id = ?3 AND household_id = ?2)`,
    ).bind(crypto.randomUUID(), householdId, id, input.externalUrl));
  }
  const results = await db.batch(statements);
  if ((results[0]?.meta.changes ?? 0) !== 1) {
    throw new D1NotFoundError("管理対象が見つかりません。");
  }
}

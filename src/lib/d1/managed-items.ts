import { getCurrentHouseholdId, requireHouseholdMembership, type D1Session } from "./authorization";
import { D1NotFoundError } from "./errors";
import { likeSearchPattern } from "./text-search";

// Issue #218: 台帳一覧の検索・絞り込み。大分類(kindCode)・詳しい種類
// (itemTypeCode)は既存の分類候補(listManagedItemClassificationOptions)の
// コード値と一致するものだけを絞り込み条件にする(利用者向けラベルと
// データモデルを混同しない、issue本文の設計メモ)。カスタム入力の詳しい種類
// (itemTypeCode未設定)は、itemTypeCodeでの絞り込みには一致しない。
export type ManagedItemFilter = {
  itemTypeCode?: string;
  kindCode?: string;
  search?: string;
};

export type ManagedItemClassificationOptions = {
  itemTypes: { code: string; kindCode: string; label: string }[];
  kinds: { code: string; label: string }[];
};
export type ManagedItemClassificationInput = {
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
};
export type TaskRuleRow = {
  deadline_kind: string;
  id: string;
  recurrence_basis: string;
  task_occurrences: TaskOccurrenceRow[];
  title: string;
};
// Issue #42: 家庭内での呼び名(name)とは別に残す任意の記録。いずれも未設定を許す。
export type ManagedItemOptionalAttributes = {
  note: string | null;
  productInfo: string | null;
  purchasedOn: string | null;
};
export type ManagedItemDetailRow = ManagedItemSummary
  & ManagedItemOptionalAttributes
  & {
    external_links: { id: string; url: string }[];
    household_id: string;
    task_rules: TaskRuleRow[];
  };

const OPTIONAL_ATTRIBUTE_SELECT =
  "m.note, m.product_info AS productInfo, m.purchased_on AS purchasedOn";

type ClassificationDefinition = { legacyKind: string };

const MANAGED_ITEM_CLASSIFICATION_SELECT = `
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
  const searchPattern = likeSearchPattern(filter?.search);
  // MANAGED_ITEM_CLASSIFICATION_SELECT自体にはcreated_atを含めない(他の
  // 呼び出し元(getManagedItem等)の公開する行の形へ意図せず漏らさないため)。
  // 並び替えのためだけにmanaged_itemsへ結合し直す(getManagedItemForEdit等と
  // 同じ「サブクエリを結合し直す」パターン)。
  const { results } = await db.prepare(
    `SELECT item.id, item.name, item.kindCode, item.kindLabel,
            item.itemTypeCode, item.itemTypeLabel
       FROM (${MANAGED_ITEM_CLASSIFICATION_SELECT}
              WHERE m.household_id = ?1) item
       JOIN managed_items m ON m.id = item.id
      WHERE (?2 IS NULL OR item.kindCode = ?2)
        AND (?3 IS NULL OR item.itemTypeCode = ?3)
        AND (?4 IS NULL OR LOWER(item.name) LIKE ?4 ESCAPE '\\')
      ORDER BY m.created_at DESC, m.id DESC`,
  ).bind(householdId, kindCode, itemTypeCode, searchPattern).all<ManagedItemSummary>();
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
      id, household_id, name, kind, note, product_info, purchased_on
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
    .bind(
      itemId,
      householdId,
      input.name,
      classification.legacyKind,
      input.note,
      input.productInfo,
      input.purchasedOn,
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

export async function getManagedItemHouseholdId(db: D1Database, session: D1Session, id: string): Promise<string> {
  const householdId = await requireCurrentHousehold(db, session);
  const item = await db.prepare("SELECT id FROM managed_items WHERE id = ?1 AND household_id = ?2")
    .bind(id, householdId).first();
  if (item === null) throw new D1NotFoundError("管理対象が見つかりません。");
  return householdId;
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
// Issue #42のメモ・商品情報・購入時期は名前と同じ行にあるため、同じ
// UPDATE一文で更新される(未設定化はNULLの書き込みで表す)。
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
          SET name = ?1, kind = ?2, note = ?5, product_info = ?6, purchased_on = ?7
        WHERE id = ?3 AND household_id = ?4`,
    ).bind(
      input.name,
      classification.legacyKind,
      id,
      householdId,
      input.note,
      input.productInfo,
      input.purchasedOn,
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

type FlatOccurrence = Omit<TaskOccurrenceRow, "activity_logs"> & {
  task_rule_id: string;
};

type FlatLog = ActivityLogRow & { task_occurrence_id: string };

function attachActivityLogs(
  occurrences: FlatOccurrence[],
  logs: FlatLog[],
): Map<string, TaskOccurrenceRow[]> {
  const logsByOccurrence = new Map<string, ActivityLogRow[]>();
  for (const log of logs) {
    const current = logsByOccurrence.get(log.task_occurrence_id) ?? [];
    current.push(log);
    logsByOccurrence.set(log.task_occurrence_id, current);
  }
  const occurrencesByRule = new Map<string, TaskOccurrenceRow[]>();
  for (const occurrence of occurrences) {
    const current = occurrencesByRule.get(occurrence.task_rule_id) ?? [];
    current.push({
      activity_logs: logsByOccurrence.get(occurrence.id) ?? [],
      assignee_user_id: occurrence.assignee_user_id,
      due_at: occurrence.due_at,
      id: occurrence.id,
      scheduled_for: occurrence.scheduled_for,
      status: occurrence.status,
    });
    occurrencesByRule.set(occurrence.task_rule_id, current);
  }
  return occurrencesByRule;
}

type ManagedItemDetailHead = ManagedItemSummary
  & ManagedItemOptionalAttributes
  & { household_id: string };

function loadManagedItemDetailHead(
  db: D1Database,
  id: string,
  householdId: string,
): Promise<ManagedItemDetailHead | null> {
  return db.prepare(
    `SELECT item.*, m.household_id, ${OPTIONAL_ATTRIBUTE_SELECT}
       FROM (${MANAGED_ITEM_CLASSIFICATION_SELECT}
              WHERE m.id = ?1 AND m.household_id = ?2) item
       JOIN managed_items m ON m.id = item.id`,
  ).bind(id, householdId).first<ManagedItemDetailHead>();
}

export async function loadManagedItemDetail(
  db: D1Database,
  session: D1Session,
  id: string,
): Promise<ManagedItemDetailRow | null> {
  const householdId = await requireCurrentHousehold(db, session);
  const item = await loadManagedItemDetailHead(db, id, householdId);
  if (item === null) return null;
  const [links, rules, occurrences, logs] = await Promise.all([
    db.prepare("SELECT id, url FROM external_links WHERE managed_item_id = ?1 AND household_id = ?2 ORDER BY created_at, id")
      .bind(id, householdId).all<{ id: string; url: string }>(),
    db.prepare("SELECT id, title, deadline_kind, recurrence_basis FROM task_rules WHERE managed_item_id = ?1 AND household_id = ?2 ORDER BY created_at, id")
      .bind(id, householdId).all<Omit<TaskRuleRow, "task_occurrences">>(),
    db.prepare(
      `SELECT o.id, o.task_rule_id, o.status, o.scheduled_for, o.due_at, o.assignee_user_id
         FROM task_occurrences o
         JOIN task_rules r ON r.id = o.task_rule_id AND r.household_id = o.household_id
        WHERE r.managed_item_id = ?1 AND o.household_id = ?2
        ORDER BY o.scheduled_for IS NOT NULL, o.scheduled_for, o.id`,
    ).bind(id, householdId).all<FlatOccurrence>(),
    db.prepare(
      // #148: completedの行はcompletion_correctionsに訂正があれば有効値へ
      // 差し替える(YDR-026)。元のl.occurred_at/l.performed_by_user_id自体は
      // 書き換えない。corrected_activity_log_idはcompleted行しか参照しない
      // ため、他actionの行では相関サブクエリが常にNULLになりl側の値へ
      // フォールバックする。
      `SELECT l.id, l.task_occurrence_id, l.action,
              coalesce(
                (SELECT c.new_occurred_at FROM completion_corrections c
                   WHERE c.completed_activity_log_id = l.id AND c.household_id = l.household_id
                     AND c.new_occurred_at IS NOT NULL
                   ORDER BY c.corrected_at DESC, c.id DESC LIMIT 1),
                l.occurred_at
              ) AS occurred_at,
              l.recorded_at,
              coalesce(
                (SELECT c.new_performed_by_user_id FROM completion_corrections c
                   WHERE c.completed_activity_log_id = l.id AND c.household_id = l.household_id
                     AND c.new_performed_by_user_id IS NOT NULL
                   ORDER BY c.corrected_at DESC, c.id DESC LIMIT 1),
                l.performed_by_user_id
              ) AS performed_by_user_id
         FROM activity_logs l
         JOIN task_occurrences o ON o.id = l.task_occurrence_id AND o.household_id = l.household_id
         JOIN task_rules r ON r.id = o.task_rule_id AND r.household_id = o.household_id
        WHERE r.managed_item_id = ?1 AND l.household_id = ?2
        ORDER BY l.recorded_at, l.id`,
    ).bind(id, householdId).all<FlatLog>(),
  ]);
  const occurrencesByRule = attachActivityLogs(occurrences.results, logs.results);
  return {
    ...item,
    external_links: links.results,
    task_rules: rules.results.map((rule) => ({
      ...rule,
      task_occurrences: occurrencesByRule.get(rule.id) ?? [],
    })),
  };
}

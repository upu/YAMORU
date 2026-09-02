import { requireCurrentHouseholdId, type D1Session } from "./authorization";
import { D1NotFoundError } from "./errors";

export type ConsumableStockStatus = "available" | "low" | "out";

export type ConsumableSummary = {
  id: string;
  name: string;
  stockStatus: ConsumableStockStatus;
};

export type ConsumableRelationOption = {
  id: string;
  name: string;
};

export type ConsumableTaskRuleOption = {
  id: string;
  managedItemName: string | null;
  title: string;
};

export type ConsumableTaskRuleNextOccurrence = {
  dueAt: string | null;
  scheduledFor: string | null;
};

export type ConsumableRefill = {
  id: string;
  recordedAt: string;
  refilledOn: string;
};

export type ConsumableRelatedTaskRule = ConsumableTaskRuleOption & {
  nextOccurrence: ConsumableTaskRuleNextOccurrence | null;
};

// 消耗品本体の属性。#311で詳細画面から関連を操作できるようにしたため、
// 編集フォームの保存は本体属性だけを書き換え、関連には触れない。
export type ConsumableAttributesInput = {
  externalUrl: string | null;
  name: string;
  note: string | null;
  productCode: string | null;
};

// 登録時は詳細画面がまだ無いため、最初の関連もまとめて受け取る。
export type ConsumableWriteInput = ConsumableAttributesInput & {
  managedItemIds: string[];
  taskRuleIds: string[];
};

export type ConsumableDetail = {
  externalUrl: string | null;
  id: string;
  managedItems: ConsumableRelationOption[];
  name: string;
  note: string | null;
  productCode: string | null;
  refills: ConsumableRefill[];
  stockStatus: ConsumableStockStatus;
  taskRules: ConsumableRelatedTaskRule[];
};

type ConsumableRelatedTaskRuleRow = ConsumableTaskRuleOption & {
  dueAt: string | null;
  occurrenceId: string | null;
  scheduledFor: string | null;
};

type ConsumableRow = {
  external_url: string | null;
  id: string;
  name: string;
  note: string | null;
  product_code: string | null;
  stock_status: ConsumableStockStatus;
};

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function relationStatements(
  db: D1Database,
  householdId: string,
  consumableId: string,
  input: ConsumableWriteInput,
): D1PreparedStatement[] {
  return [
    ...uniqueIds(input.managedItemIds).map((managedItemId) => db.prepare(
      `INSERT INTO managed_item_consumables (
        household_id, managed_item_id, consumable_id
      ) VALUES (?1, ?2, ?3)`,
    ).bind(householdId, managedItemId, consumableId)),
    ...uniqueIds(input.taskRuleIds).map((taskRuleId) => db.prepare(
      `INSERT INTO task_rule_consumables (
        household_id, task_rule_id, consumable_id
      ) VALUES (?1, ?2, ?3)`,
    ).bind(householdId, taskRuleId, consumableId)),
  ];
}

export async function createConsumable(
  db: D1Database,
  session: D1Session,
  input: ConsumableWriteInput,
): Promise<string> {
  const householdId = await requireCurrentHouseholdId(db, session);
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare(
      `INSERT INTO consumables (
        id, household_id, name, note, product_code, external_url
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    ).bind(id, householdId, input.name, input.note, input.productCode, input.externalUrl),
    ...relationStatements(db, householdId, id, input),
  ]);
  return id;
}

export async function listConsumables(
  db: D1Database,
  session: D1Session,
): Promise<ConsumableSummary[]> {
  const householdId = await requireCurrentHouseholdId(db, session);
  const { results } = await db.prepare(
    `SELECT id, name, stock_status AS stockStatus
       FROM consumables WHERE household_id = ?1 ORDER BY name COLLATE NOCASE, id`,
  ).bind(householdId).all<ConsumableSummary>();
  return results;
}

async function loadConsumableRow(
  db: D1Database,
  householdId: string,
  id: string,
): Promise<ConsumableRow | null> {
  return db.prepare(
    `SELECT id, name, note, product_code, external_url, stock_status
       FROM consumables WHERE id = ?1 AND household_id = ?2`,
  ).bind(id, householdId).first<ConsumableRow>();
}

function loadConsumableManagedItems(
  db: D1Database,
  householdId: string,
  id: string,
) {
  return db.prepare(
    `SELECT m.id, m.name
       FROM managed_item_consumables r
       JOIN managed_items m
         ON m.id = r.managed_item_id AND m.household_id = r.household_id
      WHERE r.consumable_id = ?1 AND r.household_id = ?2
      ORDER BY m.name COLLATE NOCASE, m.id`,
  ).bind(id, householdId).all<ConsumableRelationOption>();
}

function loadConsumableTaskRules(
  db: D1Database,
  householdId: string,
  id: string,
) {
  return db.prepare(
    `SELECT t.id, t.title, m.name AS managedItemName,
            o.id AS occurrenceId,
            o.scheduled_for AS scheduledFor,
            o.due_at AS dueAt
       FROM task_rule_consumables r
       JOIN task_rules t
         ON t.id = r.task_rule_id AND t.household_id = r.household_id
       LEFT JOIN managed_items m
         ON m.id = t.managed_item_id AND m.household_id = t.household_id
       LEFT JOIN task_occurrences o
         ON o.task_rule_id = t.id
        AND o.household_id = t.household_id
        AND o.status = 'pending'
      WHERE r.consumable_id = ?1 AND r.household_id = ?2
      ORDER BY t.title COLLATE NOCASE, t.id`,
  ).bind(id, householdId).all<ConsumableRelatedTaskRuleRow>();
}

function loadConsumableRefills(
  db: D1Database,
  householdId: string,
  id: string,
) {
  return db.prepare(
    `SELECT id, refilled_on AS refilledOn, recorded_at AS recordedAt
       FROM consumable_refills
      WHERE consumable_id = ?1 AND household_id = ?2
      ORDER BY refilled_on DESC, recorded_at DESC, id DESC`,
  ).bind(id, householdId).all<ConsumableRefill>();
}

export async function getConsumable(
  db: D1Database,
  session: D1Session,
  id: string,
): Promise<ConsumableDetail | null> {
  const householdId = await requireCurrentHouseholdId(db, session);
  const row = await loadConsumableRow(db, householdId, id);
  if (row === null) return null;
  const [managedItems, taskRules, refills] = await Promise.all([
    loadConsumableManagedItems(db, householdId, id),
    loadConsumableTaskRules(db, householdId, id),
    loadConsumableRefills(db, householdId, id),
  ]);
  return {
    externalUrl: row.external_url,
    id: row.id,
    managedItems: managedItems.results,
    name: row.name,
    note: row.note,
    productCode: row.product_code,
    refills: refills.results,
    stockStatus: row.stock_status,
    taskRules: taskRules.results.map((taskRule) => ({
      id: taskRule.id,
      managedItemName: taskRule.managedItemName,
      nextOccurrence: taskRule.occurrenceId === null
        ? null
        : {
            dueAt: taskRule.dueAt,
            scheduledFor: taskRule.scheduledFor,
          },
      title: taskRule.title,
    })),
  };
}

export async function recordConsumableRefill(
  db: D1Database,
  session: D1Session,
  id: string,
  refilledOn: string,
): Promise<void> {
  const householdId = await requireCurrentHouseholdId(db, session);
  if (await loadConsumableRow(db, householdId, id) === null) {
    throw new D1NotFoundError("消耗品が見つかりません。");
  }
  const refillId = crypto.randomUUID();
  // D1のbatchは一つのトランザクションとして扱われる。履歴追加が制約違反で
  // 失敗した場合も、現在の在庫状態だけを「ある」へ変えない。
  await db.batch([
    db.prepare(
      `UPDATE consumables
          SET stock_status = 'available',
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?1 AND household_id = ?2`,
    ).bind(id, householdId),
    db.prepare(
      `INSERT INTO consumable_refills (
        id, household_id, consumable_id, refilled_on
      ) VALUES (?1, ?2, ?3, ?4)`,
    ).bind(refillId, householdId, id, refilledOn),
  ]);
}

export async function updateConsumable(
  db: D1Database,
  session: D1Session,
  id: string,
  input: ConsumableAttributesInput,
): Promise<void> {
  const householdId = await requireCurrentHouseholdId(db, session);
  const result = await db.prepare(
    `UPDATE consumables
        SET name = ?1, note = ?2, product_code = ?3, external_url = ?4,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?5 AND household_id = ?6`,
  ).bind(input.name, input.note, input.productCode, input.externalUrl, id, householdId).run();
  if (result.meta.changes !== 1) {
    throw new D1NotFoundError("消耗品が見つかりません。");
  }
}

// Issue #311: 消耗品詳細の関連表示から1件ずつ追加・解除する。登録時の
// まとめ書き(#44)と違い、他の関連には触れない。同じ関連を重ねて追加しても
// 主キーの重複を無視して1件のままにし、家庭をまたぐIDは(id, household_id)の
// 複合外部キーがDB側で拒否する。
async function requireConsumableHousehold(
  db: D1Database,
  session: D1Session,
  consumableId: string,
): Promise<string> {
  const householdId = await requireCurrentHouseholdId(db, session);
  if (await loadConsumableRow(db, householdId, consumableId) === null) {
    throw new D1NotFoundError("消耗品が見つかりません。");
  }
  return householdId;
}

export async function setConsumableManagedItemRelation(
  db: D1Database,
  session: D1Session,
  consumableId: string,
  managedItemId: string,
  related: boolean,
): Promise<void> {
  const householdId = await requireConsumableHousehold(db, session, consumableId);
  await (related
    ? db.prepare(
        `INSERT OR IGNORE INTO managed_item_consumables (
          household_id, managed_item_id, consumable_id
        ) VALUES (?1, ?2, ?3)`,
      )
    : db.prepare(
        `DELETE FROM managed_item_consumables
          WHERE household_id = ?1 AND managed_item_id = ?2 AND consumable_id = ?3`,
      )
  ).bind(householdId, managedItemId, consumableId).run();
}

export async function setConsumableTaskRuleRelation(
  db: D1Database,
  session: D1Session,
  consumableId: string,
  taskRuleId: string,
  related: boolean,
): Promise<void> {
  const householdId = await requireConsumableHousehold(db, session, consumableId);
  await (related
    ? db.prepare(
        `INSERT OR IGNORE INTO task_rule_consumables (
          household_id, task_rule_id, consumable_id
        ) VALUES (?1, ?2, ?3)`,
      )
    : db.prepare(
        `DELETE FROM task_rule_consumables
          WHERE household_id = ?1 AND task_rule_id = ?2 AND consumable_id = ?3`,
      )
  ).bind(householdId, taskRuleId, consumableId).run();
}

export async function updateConsumableStockStatus(
  db: D1Database,
  session: D1Session,
  id: string,
  stockStatus: ConsumableStockStatus,
): Promise<void> {
  const householdId = await requireCurrentHouseholdId(db, session);
  const result = await db.prepare(
    `UPDATE consumables
        SET stock_status = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?2 AND household_id = ?3`,
  ).bind(stockStatus, id, householdId).run();
  if (result.meta.changes !== 1) {
    throw new D1NotFoundError("消耗品が見つかりません。");
  }
}

export async function listShoppingCandidates(
  db: D1Database,
  session: D1Session,
): Promise<ConsumableSummary[]> {
  const householdId = await requireCurrentHouseholdId(db, session);
  const { results } = await db.prepare(
    `SELECT id, name, stock_status AS stockStatus
       FROM consumables
      WHERE household_id = ?1 AND stock_status IN ('low', 'out')
      ORDER BY name COLLATE NOCASE, id`,
  ).bind(householdId).all<ConsumableSummary>();
  return results;
}

export async function listConsumablesForManagedItem(
  db: D1Database,
  session: D1Session,
  managedItemId: string,
): Promise<ConsumableSummary[]> {
  const householdId = await requireCurrentHouseholdId(db, session);
  const { results } = await db.prepare(
    `SELECT c.id, c.name, c.stock_status AS stockStatus
       FROM managed_item_consumables r
       JOIN consumables c
         ON c.id = r.consumable_id AND c.household_id = r.household_id
      WHERE r.managed_item_id = ?1 AND r.household_id = ?2
      ORDER BY c.name COLLATE NOCASE, c.id`,
  ).bind(managedItemId, householdId).all<ConsumableSummary>();
  return results;
}

export async function listConsumablesForTaskRule(
  db: D1Database,
  session: D1Session,
  taskRuleId: string,
): Promise<ConsumableSummary[]> {
  const householdId = await requireCurrentHouseholdId(db, session);
  const { results } = await db.prepare(
    `SELECT c.id, c.name, c.stock_status AS stockStatus
       FROM task_rule_consumables r
       JOIN consumables c
         ON c.id = r.consumable_id AND c.household_id = r.household_id
      WHERE r.task_rule_id = ?1 AND r.household_id = ?2
      ORDER BY c.name COLLATE NOCASE, c.id`,
  ).bind(taskRuleId, householdId).all<ConsumableSummary>();
  return results;
}

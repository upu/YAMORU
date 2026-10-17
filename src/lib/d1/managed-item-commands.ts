import { D1Error, D1NotFoundError } from "./errors";
import {
  loadManagedItemForEdit,
  managedItemInsertStatements,
  managedItemUpdateStatements,
  requireActiveClassification,
  type ManagedItemWriteInput,
} from "./managed-items";
import { assertManagedItemTagLimit, type Tag } from "./tags";
import type { BusinessStatements } from "./todos/command-plans";

// 外部command(#437)のmanaged_item.create / managed_item.update。保存の文は
// Webの登録・編集と同じものを使い、ここでは分類・タグの確認と、受付記録と
// 同じbatchへ載せる文の組み立てだけを持つ。Webの登録は他家庭のタグIDを複合外部キー違反として拒否するが、
// commandでは入力の誤りとして返すため、batchの前に家庭内のタグかを確かめる。

export type ManagedItemWritePlan = {
  input: ManagedItemWriteInput & { legacyKind: string };
  tags: Tag[];
};

async function requireHouseholdTags(db: D1Database, householdId: string, tagIds: string[]): Promise<Tag[]> {
  if (tagIds.length === 0) return [];
  const { results } = await db.prepare(
    `SELECT id, name FROM tags
      WHERE household_id = ?1 AND id IN (SELECT value FROM json_each(?2))`,
  ).bind(householdId, JSON.stringify(tagIds)).all<Tag>();
  if (results.length !== tagIds.length) throw new D1Error("Tag not found in household", "TAG_NOT_FOUND");
  const byId = new Map(results.map((tag) => [tag.id, tag]));
  return tagIds.map((id) => byId.get(id) as Tag);
}

export type ManagedItemCommandInput = Omit<ManagedItemWriteInput, "tags"> & { tagIds: string[] };

async function planWrite(db: D1Database, householdId: string, input: ManagedItemCommandInput): Promise<ManagedItemWritePlan> {
  const classification = await requireActiveClassification(db, input);
  const tags = await requireHouseholdTags(db, householdId, input.tagIds);
  const tagInput = { newTagNames: [], tagIds: input.tagIds };
  await assertManagedItemTagLimit(db, householdId, tagInput);
  return { input: { ...input, legacyKind: classification.legacyKind, tags: tagInput }, tags };
}

export function planManagedItemCreation(
  db: D1Database,
  householdId: string,
  input: ManagedItemCommandInput,
): Promise<ManagedItemWritePlan> {
  return planWrite(db, householdId, input);
}

export function managedItemCreationStatements(
  db: D1Database,
  householdId: string,
  plan: ManagedItemWritePlan,
  itemId: string,
): BusinessStatements {
  return {
    evidence: [{ rowId: itemId, table: "managed_items" }],
    statements: managedItemInsertStatements(db, householdId, itemId, plan.input),
  };
}

// 編集前の値。previewで変更前後を示し、指定しなかった項目はこの値を保つ。
export type ManagedItemSnapshot = ManagedItemCommandInput & { tags: Tag[] };

export async function loadManagedItemSnapshot(
  db: D1Database,
  householdId: string,
  itemId: string,
): Promise<ManagedItemSnapshot> {
  const item = await loadManagedItemForEdit(db, householdId, itemId);
  if (item === null) throw new D1NotFoundError("Managed item not found", "MANAGED_ITEM_NOT_FOUND");
  const { results: tags } = await db.prepare(
    `SELECT t.id, t.name FROM managed_item_tags m JOIN tags t ON t.id = m.tag_id AND t.household_id = m.household_id
      WHERE m.household_id = ?1 AND m.managed_item_id = ?2 ORDER BY t.name, t.id`,
  ).bind(householdId, itemId).all<Tag>();
  return {
    customItemType: item.customItemType,
    externalUrl: item.externalUrl,
    itemTypeCode: item.itemTypeCode,
    kindCode: item.kindCode,
    name: item.name,
    note: item.note,
    productInfo: item.productInfo,
    startedOn: item.startedOn,
    tagIds: tags.map((tag) => tag.id),
    tags,
  };
}

export function planManagedItemUpdate(
  db: D1Database,
  householdId: string,
  input: ManagedItemCommandInput,
): Promise<ManagedItemWritePlan> {
  return planWrite(db, householdId, input);
}

// 編集の文と、batchの後に管理対象が編集後の値を持つことの証跡。
export function managedItemUpdateCommandStatements(
  db: D1Database,
  householdId: string,
  plan: ManagedItemWritePlan,
  itemId: string,
): BusinessStatements {
  const { input } = plan;
  return {
    evidence: [{
      rowId: itemId,
      table: "managed_items",
      values: {
        kind: input.legacyKind,
        name: input.name,
        note: input.note,
        product_info: input.productInfo,
        started_on: input.startedOn,
      },
    }],
    statements: managedItemUpdateStatements(db, householdId, itemId, input),
  };
}


import { D1Error } from "./errors";
import {
  managedItemInsertStatements,
  requireActiveClassification,
  type ManagedItemWriteInput,
} from "./managed-items";
import { assertManagedItemTagLimit, type Tag } from "./tags";
import type { BusinessStatements } from "./todos/command-plans";

// 外部command(#437)のmanaged_item.create。保存の文はWebの登録と同じものを
// 使い、ここでは分類・タグの確認と、受付記録と同じbatchへ載せる文の組み立て
// だけを持つ。Webの登録は他家庭のタグIDを複合外部キー違反として拒否するが、
// commandでは入力の誤りとして返すため、batchの前に家庭内のタグかを確かめる。

export type ManagedItemCreationPlan = {
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

export async function planManagedItemCreation(
  db: D1Database,
  householdId: string,
  input: Omit<ManagedItemWriteInput, "tags"> & { tagIds: string[] },
): Promise<ManagedItemCreationPlan> {
  const classification = await requireActiveClassification(db, input);
  const tags = await requireHouseholdTags(db, householdId, input.tagIds);
  const tagInput = { newTagNames: [], tagIds: input.tagIds };
  await assertManagedItemTagLimit(db, householdId, tagInput);
  return { input: { ...input, legacyKind: classification.legacyKind, tags: tagInput }, tags };
}

export function managedItemCreationStatements(
  db: D1Database,
  householdId: string,
  plan: ManagedItemCreationPlan,
  itemId: string,
): BusinessStatements {
  return {
    evidence: [{ rowId: itemId, table: "managed_items" }],
    statements: managedItemInsertStatements(db, householdId, itemId, plan.input),
  };
}

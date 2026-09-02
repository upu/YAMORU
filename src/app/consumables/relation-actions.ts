"use server";

import { revalidatePath } from "next/cache";

import {
  searchConsumableManagedItemCandidates,
  searchConsumableTaskRuleCandidates,
} from "../../lib/d1/consumable-relations";
import {
  setConsumableManagedItemRelation as setConsumableManagedItemRelationInD1,
  setConsumableTaskRuleRelation as setConsumableTaskRuleRelationInD1,
  type ConsumableRelationOption,
  type ConsumableTaskRuleOption,
} from "../../lib/d1/consumables";
import { getD1Context } from "../../lib/d1/context";

// Issue #292: 関連付けの追加ダイアログが、入力に応じて候補を取り寄せる
// (issue本文の設計メモの案3)。候補の絞り込みも件数もサーバー側の
// household_id条件の内側で決まるため、クライアントから渡された値で
// 他家庭の管理対象・Todoへ届くことはない。
export type ConsumableCandidateResult<T> =
  | { hasMore: boolean; items: T[]; status: "ok" }
  | { message: string; status: "error" };

const CANDIDATE_ERROR_MESSAGE = "候補を取得できませんでした。時間をおいて再度お試しください。";

// サーバーアクションの引数は利用者側から任意の値を渡せるため、文字列以外は
// 落としてからD1層へ渡す。
function textArgument(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function idListArgument(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export async function searchConsumableManagedItems(
  search: string,
): Promise<ConsumableCandidateResult<ConsumableRelationOption>> {
  try {
    const { db, session } = await getD1Context();
    const page = await searchConsumableManagedItemCandidates(
      db,
      session,
      textArgument(search),
    );
    return { hasMore: page.hasMore, items: page.items, status: "ok" };
  } catch {
    return { message: CANDIDATE_ERROR_MESSAGE, status: "error" };
  }
}

export async function searchConsumableTaskRules(
  search: string,
  relatedManagedItemIds: string[],
): Promise<ConsumableCandidateResult<ConsumableTaskRuleOption>> {
  try {
    const { db, session } = await getD1Context();
    const page = await searchConsumableTaskRuleCandidates(
      db,
      session,
      textArgument(search),
      idListArgument(relatedManagedItemIds),
    );
    return { hasMore: page.hasMore, items: page.items, status: "ok" };
  } catch {
    return { message: CANDIDATE_ERROR_MESSAGE, status: "error" };
  }
}

// Issue #311: 消耗品詳細の関連表示から、1件ずつ追加・解除する。追加も解除も
// 同じ「関連付いている/いない」の切り替えとして扱い、候補ダイアログの
// チェック操作と一覧の解除ボタンで同じ動きにする。
export type ConsumableRelationUpdateResult =
  | { status: "ok" }
  | { message: string; status: "error" };

const RELATION_ERROR_MESSAGE = "関連を更新できませんでした。時間をおいて再度お試しください。";

const INVALID_RELATION_RESULT: ConsumableRelationUpdateResult = {
  message: "関連付ける対象を選び直してください。",
  status: "error",
};

// サーバーアクションの引数は利用者側から任意の値を渡せるため、想定した形の
// 値だけをD1層へ渡す。IDが家庭のものかはD1層のhousehold_id条件が決める。
function relationIds(
  consumableId: unknown,
  relatedId: unknown,
  related: unknown,
): { consumableId: string; related: boolean; relatedId: string } | null {
  if (typeof consumableId !== "string" || consumableId.trim() === "") return null;
  if (typeof relatedId !== "string" || relatedId.trim() === "") return null;
  if (typeof related !== "boolean") return null;
  return { consumableId: consumableId.trim(), related, relatedId: relatedId.trim() };
}

function revalidateConsumableRelations(consumableId: string): void {
  revalidatePath("/consumables");
  revalidatePath(`/consumables/${encodeURIComponent(consumableId)}`);
  revalidatePath("/managed-items");
  revalidatePath("/todos");
}

export async function setConsumableManagedItemRelation(
  consumableId: string,
  managedItemId: string,
  related: boolean,
): Promise<ConsumableRelationUpdateResult> {
  const parsed = relationIds(consumableId, managedItemId, related);
  if (parsed === null) return INVALID_RELATION_RESULT;

  try {
    const { db, session } = await getD1Context();
    await setConsumableManagedItemRelationInD1(
      db,
      session,
      parsed.consumableId,
      parsed.relatedId,
      parsed.related,
    );
  } catch {
    return { message: RELATION_ERROR_MESSAGE, status: "error" };
  }

  revalidateConsumableRelations(parsed.consumableId);
  return { status: "ok" };
}

export async function setConsumableTaskRuleRelation(
  consumableId: string,
  taskRuleId: string,
  related: boolean,
): Promise<ConsumableRelationUpdateResult> {
  const parsed = relationIds(consumableId, taskRuleId, related);
  if (parsed === null) return INVALID_RELATION_RESULT;

  try {
    const { db, session } = await getD1Context();
    await setConsumableTaskRuleRelationInD1(
      db,
      session,
      parsed.consumableId,
      parsed.relatedId,
      parsed.related,
    );
  } catch {
    return { message: RELATION_ERROR_MESSAGE, status: "error" };
  }

  revalidateConsumableRelations(parsed.consumableId);
  return { status: "ok" };
}

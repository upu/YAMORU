"use server";

import {
  searchConsumableManagedItemCandidates,
  searchConsumableTaskRuleCandidates,
} from "../../lib/d1/consumable-relations";
import type {
  ConsumableRelationOption,
  ConsumableTaskRuleOption,
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

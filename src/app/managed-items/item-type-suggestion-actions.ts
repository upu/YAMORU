"use server";

import { generateText } from "../../lib/ai/text-generation";
import { getD1Context } from "../../lib/d1/context";
import {
  listHouseholdItemTypeAdoptions,
  recordItemTypeSuggestion,
} from "../../lib/d1/item-type-suggestions";
import {
  listHouseholdCustomItemTypes,
  listManagedItemClassificationOptions,
} from "../../lib/d1/managed-items";
import { findItemTypeKnowledge } from "../../lib/managed-items/item-type-knowledge";
import {
  buildItemTypePrompt,
  type ItemTypeSuggestionContext,
  parseItemTypeSuggestions,
} from "../../lib/managed-items/item-type-suggestion";

// Issue #332: 利用者が明示的に押したときだけ「詳しい種類」の候補を作る。
// 自動確定はせず、返すのはあくまで候補で、最終的な値は利用者が選ぶ(YDR-008)。
export type ItemTypeSuggestionResult =
  | { message: string; status: "error" }
  | { status: "ok"; suggestionId: string; suggestions: string[] };

export type ItemTypeSuggestionInput = {
  currentItemTypeText: string;
  itemName: string;
  kindCode: string;
  note: string;
  productInfo: string;
};

const UNAVAILABLE_MESSAGE =
  "いまは候補を出せません。これまでどおり自分で入力できます。";
const EMPTY_MESSAGE =
  "候補を思いつきませんでした。名前やメモを足すと変わることがあります。";
const NAME_REQUIRED_MESSAGE = "先に名前を入力すると候補を出せます。";

// 送るのは分類の手がかりになる範囲だけにし、AI側で扱う長さも抑える。
function trimmed(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeInput(input: ItemTypeSuggestionInput): ItemTypeSuggestionInput {
  return {
    currentItemTypeText: trimmed(input.currentItemTypeText, 50),
    itemName: trimmed(input.itemName, 100),
    kindCode: trimmed(input.kindCode, 50),
    note: trimmed(input.note, 1000),
    productInfo: trimmed(input.productInfo, 200),
  };
}

// 大分類のラベルは画面から受け取らず、保存済みの分類定義から引き直す。
// 家庭内の既存の詳しい種類は、選択中の大分類のものだけを集める(#288の
// 候補取得と同じ絞り込み)。他家庭のデータはlistHouseholdCustomItemTypesと
// listHouseholdItemTypeAdoptionsがhousehold_idで除くため混ざらない。
async function loadContext(
  db: D1Database,
  session: { userId: string },
  input: ItemTypeSuggestionInput,
): Promise<ItemTypeSuggestionContext | null> {
  const [classificationOptions, customItemTypes, adoptions] = await Promise.all([
    listManagedItemClassificationOptions(db),
    listHouseholdCustomItemTypes(db, session),
    listHouseholdItemTypeAdoptions(db, session, input.kindCode),
  ]);
  const kindLabel = classificationOptions.kinds.find(
    (kind) => kind.code === input.kindCode,
  )?.label;
  if (kindLabel === undefined) return null;

  const householdItemTypes = [
    ...customItemTypes.filter((option) => option.kindCode === input.kindCode),
    ...classificationOptions.itemTypes.filter(
      (itemType) => itemType.kindCode === input.kindCode,
    ),
  ].map((option) => option.label);

  return {
    adoptions,
    currentItemTypeText: input.currentItemTypeText,
    householdItemTypes,
    itemName: input.itemName,
    kindLabel,
    knowledge: findItemTypeKnowledge({
      kindCode: input.kindCode,
      text: [
        input.itemName,
        input.productInfo,
        input.note,
        input.currentItemTypeText,
      ].join(" "),
    }),
    note: input.note,
    productInfo: input.productInfo,
  };
}

// AIが使えない・時間内に返らない・候補を読み取れないときは、いずれもエラー
// 文言を返すだけにする。呼び出し元のフォームはそのまま操作を続けられる。
export async function suggestItemTypes(
  rawInput: ItemTypeSuggestionInput,
): Promise<ItemTypeSuggestionResult> {
  const input = normalizeInput(rawInput);
  if (input.itemName === "") {
    return { message: NAME_REQUIRED_MESSAGE, status: "error" };
  }

  try {
    const { db, session } = await getD1Context();
    const context = await loadContext(db, session, input);
    if (context === null) {
      return { message: UNAVAILABLE_MESSAGE, status: "error" };
    }

    const generated = await generateText(buildItemTypePrompt(context));
    if (generated.status !== "ok") {
      return { message: UNAVAILABLE_MESSAGE, status: "error" };
    }

    const suggestions = parseItemTypeSuggestions(
      generated.text,
      context.householdItemTypes,
    );
    if (suggestions.length === 0) {
      return { message: EMPTY_MESSAGE, status: "error" };
    }

    return {
      status: "ok",
      suggestionId: await recordItemTypeSuggestion(db, session, {
        itemName: input.itemName,
        kindCode: input.kindCode,
        suggestedLabels: suggestions,
      }),
      suggestions,
    };
  } catch {
    return { message: UNAVAILABLE_MESSAGE, status: "error" };
  }
}

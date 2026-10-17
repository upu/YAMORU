import {
  MANAGED_ITEM_TAG_MAX_COUNT,
  TAG_NAME_MAX_LENGTH,
  tagNameKey,
} from "../../lib/managed-items/tag-rules";
import type { ManagedItemActionState } from "./state";

export { TAG_NAME_MAX_LENGTH };

export const TAG_LIMIT_EXCEEDED_STATE: ManagedItemActionState = {
  message: `タグは1つの管理対象に${String(MANAGED_ITEM_TAG_MAX_COUNT)}個まで付けられます。`,
  status: "error",
};

// 新しいタグ欄は、読点・カンマ・改行で区切って一度に複数作れる。
const NEW_TAG_SEPARATOR = /[,、，\n]/u;

export type ParsedTagInput =
  | { newTagNames: string[]; status: "ok"; tagIds: string[] }
  | ManagedItemActionState;

function uniqueBy(values: string[], key: (value: string) => string): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const k = key(value);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// 登録・編集フォームのタグ指定を読む。tagIdsは既存タグのチェックボックス
// (自家庭のタグかどうかはD1側の複合外部キーが確かめる)、newTagsは新しく
// 作るタグの名前。どちらも未指定なら「タグなし」として扱う。
export function parseTagInput(formData: FormData): ParsedTagInput {
  const tagIds = uniqueBy(
    formData.getAll("tagIds")
      .filter((value): value is string => typeof value === "string")
      .filter((value) => value.length > 0),
    (value) => value,
  );

  const rawNewTags = formData.get("newTags");
  const newTagNames = uniqueBy(
    (typeof rawNewTags === "string" ? rawNewTags : "")
      .split(NEW_TAG_SEPARATOR)
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
    tagNameKey,
  );
  if (newTagNames.some((name) => Array.from(name).length > TAG_NAME_MAX_LENGTH)) {
    return {
      message: `タグは1つ${String(TAG_NAME_MAX_LENGTH)}文字以内で入力してください。`,
      status: "error",
    };
  }
  // 選択した既存タグと同じ名前を新しいタグ欄にも書くと、D1側で同じタグへ
  // まとまる。合計の上限は既存タグと突き合わせたうえでD1層が判定するため、
  // ここではそれぞれ単独で上限を超える(重複除去済みなので確実に超える)
  // 入力だけを先に断る。
  if (tagIds.length > MANAGED_ITEM_TAG_MAX_COUNT || newTagNames.length > MANAGED_ITEM_TAG_MAX_COUNT) {
    return TAG_LIMIT_EXCEEDED_STATE;
  }
  return { newTagNames, status: "ok", tagIds };
}

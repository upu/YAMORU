import type { ManagedItemActionState } from "./state";

// Issue #226 / YDR-048: タグ名の上限。d1/migrations/0029_managed_item_tags.sqlの
// CHECK制約と同じ値。
export const TAG_NAME_MAX_LENGTH = 30;
// 一つのManagedItemへ付けられるタグの上限。横断的な文脈の目印として使う
// 想定で、一覧の1行が読めなくなるほど付けさせない。
export const MANAGED_ITEM_TAG_MAX_COUNT = 10;

// 新しいタグ欄は、読点・カンマ・改行で区切って一度に複数作れる。
const NEW_TAG_SEPARATOR = /[,、，\n]/u;

export type ParsedTagInput =
  | { newTagNames: string[]; status: "ok"; tagIds: string[] }
  | ManagedItemActionState;

// D1のCOLLATE NOCASEと同じく、英字の大文字小文字だけを同一視する。
function tagNameKey(name: string): string {
  return name.replace(/[A-Z]/gu, (letter) => letter.toLowerCase());
}

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
  if (tagIds.length + newTagNames.length > MANAGED_ITEM_TAG_MAX_COUNT) {
    return {
      message: `タグは1つの管理対象に${String(MANAGED_ITEM_TAG_MAX_COUNT)}個まで付けられます。`,
      status: "error",
    };
  }
  return { newTagNames, status: "ok", tagIds };
}

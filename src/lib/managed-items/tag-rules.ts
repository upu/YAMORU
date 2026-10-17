// Issue #226 / YDR-048: ManagedItemのタグの上限と名前の同一視。画面の入力規則(src/app/
// managed-items/tag-input.ts)とD1層(src/lib/d1/tags.ts)が同じ値を使う。

// タグ名の上限。d1/migrations/0029_managed_item_tags.sqlのCHECK制約と同じ値。
export const TAG_NAME_MAX_LENGTH = 30;
// 一つのManagedItemへ付けられるタグの上限。横断的な文脈の目印として使う
// 想定で、一覧の1行が読めなくなるほど付けさせない。
export const MANAGED_ITEM_TAG_MAX_COUNT = 10;

// D1のCOLLATE NOCASEと同じく、英字の大文字小文字だけを同一視する。
export function tagNameKey(name: string): string {
  return name.replace(/[A-Z]/gu, (letter) => letter.toLowerCase());
}

// Issue #238 / #288 / #332: 自由入力の「詳しい種類」を候補と突き合わせるときは、
// 前後の空白と大文字小文字の違いを無視して比べる(listHouseholdCustomItemTypes
// がLOWER(TRIM())で家庭内の表記をまとめるのと同じ方針)。一覧の絞り込み、
// 登録・編集の入力補助、AI提案の候補整理で同じ正規化を使うため、画面側
// (src/app/managed-items/model.ts)ではなくlib側に置く。
export function normalizeItemTypeText(value: string): string {
  return value.trim().toLocaleLowerCase("ja-JP");
}

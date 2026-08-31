export type ManagedItemClassificationOptions = {
  itemTypes: { code: string; kindCode: string; label: string }[];
  kinds: { code: string; label: string }[];
};

// Issue #239: 開始時期(started_on)が保存する意味は大分類によらず「対象との
// 関係が始まった時期」で統一するが、見出し語は大分類ごとに家庭向けの自然な
// 言葉へ変える(YDR-033)。managed_item_kinds.labelとは別に、この見出し語だけ
// をアプリケーション側の定数として持つ。未知のkindCode(将来の追加や検証前の
// 入力)は「開始時期」へ丸める。
const STARTED_ON_LABELS: Record<string, string> = {
  asset: "購入時期",
  service: "利用・契約を始めた時期",
};
const DEFAULT_STARTED_ON_LABEL = "開始時期";

export function startedOnLabel(kindCode: string): string {
  return STARTED_ON_LABELS[kindCode] ?? DEFAULT_STARTED_ON_LABEL;
}

export function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}

// Issue #238 / #288: 自由入力の「詳しい種類」を候補と突き合わせるときは、
// 前後の空白と大文字小文字の違いを無視して比べる(listHouseholdCustomItemTypes
// がLOWER(TRIM())で家庭内の表記をまとめるのと同じ方針)。一覧の絞り込みと
// 登録・編集の入力補助で、同じ正規化を使う。
export function normalizeItemTypeText(value: string): string {
  return value.trim().toLocaleLowerCase("ja-JP");
}

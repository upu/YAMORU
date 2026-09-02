import Link from "next/link";

export type LedgerCategory = "asset" | "consumables" | "service";

// Issue #309: 新規登録ボタンの文言(「備品を登録」など)もこのラベルから作る。
// カテゴリを増やす・変えるときにラベルの取りこぼしが型エラーになるよう、
// LedgerCategoryを網羅するRecordを正本にする(見つからなければ空文字、という
// 実行時まで気づけない逃げ道を作らない)。
const LEDGER_CATEGORY_LABELS: Record<LedgerCategory, string> = {
  asset: "備品",
  consumables: "消耗品",
  service: "サービス・契約",
};

const LEDGER_CATEGORIES: { code: LedgerCategory; href: string }[] = [
  { code: "asset", href: "/managed-items?kind=asset" },
  { code: "service", href: "/managed-items?kind=service" },
  { code: "consumables", href: "/consumables" },
];

export function ledgerCategoryLabel(category: LedgerCategory): string {
  return LEDGER_CATEGORY_LABELS[category];
}

// Issue #291: ManagedItemの大分類と独立したConsumableをデータ上で混ぜず、
// 家庭が台帳内を移動するときだけ3つの対等な入口として見せる。
export function LedgerCategoryNavigation({
  current,
}: {
  current: LedgerCategory | undefined;
}) {
  return (
    <nav aria-label="台帳の種類" className="ledger-category-navigation">
      {LEDGER_CATEGORIES.map((category) => (
        <Link
          aria-current={current === category.code ? "page" : undefined}
          href={category.href}
          key={category.code}
        >
          {LEDGER_CATEGORY_LABELS[category.code]}
        </Link>
      ))}
    </nav>
  );
}

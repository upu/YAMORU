import Link from "next/link";

export type LedgerCategory = "asset" | "consumables" | "service";

const LEDGER_CATEGORIES: { code: LedgerCategory; href: string; label: string }[] = [
  { code: "asset", href: "/managed-items?kind=asset", label: "備品" },
  { code: "service", href: "/managed-items?kind=service", label: "サービス・契約" },
  { code: "consumables", href: "/consumables", label: "消耗品" },
];

// Issue #309: 新規登録ボタンの文言を「備品を登録」「サービス・契約を登録」
// 「消耗品を登録」と現在のカテゴリに合わせるため、切り替えと同じ言葉を使う。
export function ledgerCategoryLabel(category: LedgerCategory): string {
  return LEDGER_CATEGORIES.find((entry) => entry.code === category)?.label ?? "";
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
          {category.label}
        </Link>
      ))}
    </nav>
  );
}

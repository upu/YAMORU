import Link from "next/link";

export type LedgerCategory = "asset" | "consumables" | "service";

const LEDGER_CATEGORIES: { code: LedgerCategory; href: string; label: string }[] = [
  { code: "asset", href: "/managed-items?kind=asset", label: "備品" },
  { code: "service", href: "/managed-items?kind=service", label: "サービス・契約" },
  { code: "consumables", href: "/consumables", label: "消耗品" },
];

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

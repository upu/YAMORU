import Link from "next/link";

import { requireUser } from "../../lib/auth/current-user";
import {
  listConsumables,
  type ConsumableSummary,
} from "../../lib/d1/consumables";
import { getD1Context } from "../../lib/d1/context";
import { loadAccountState } from "../../lib/d1/households";
import { FloatingAddButton } from "../floating-add-button";
import {
  LedgerHouseholdRequiredNotice,
  LedgerListHeading,
  LedgerPageShell,
} from "../ledger-page-shell";
import type { ListAddAction } from "../list-add-link";
import { StockStatusBadge } from "./stock-status";

export type ConsumableListItem = ConsumableSummary;

// Issue #309: 消耗品も備品・サービス・契約と同じ台帳ページの骨格
// (タイトル、説明、カテゴリ切り替え、登録の入口、一覧)で表示する。
// URLとデータモデルは/managed-itemsと分けたまま(#291の方針)。
// Issue #391: 見出しの中のリンクと右下のフローティングボタンへ同じ値を渡し、
// 画面幅が変わっても追加操作の名前が変わらないようにする。
const CONSUMABLE_ADD_ACTION: ListAddAction = {
  href: "/consumables/new",
  label: "消耗品を登録",
};

export function ConsumablesContent({
  consumables,
}: {
  consumables: ConsumableListItem[];
}) {
  return (
    <LedgerPageShell currentCategory="consumables">
      <div className="ledger-grid">
        <section aria-labelledby="consumables-list-title" className="detail-card">
          <h2 className="sr-only" id="consumables-list-title">登録済みの消耗品</h2>
          <LedgerListHeading add={CONSUMABLE_ADD_ACTION} count={consumables.length} />
          {consumables.length === 0 ? (
            <p className="ledger-empty">
              まだ消耗品はありません。「消耗品を登録」から台帳に追加できます。
            </p>
          ) : (
            <ul className="ledger-list">
              {consumables.map((consumable) => (
                <li key={consumable.id}>
                  <Link href={`/consumables/${encodeURIComponent(consumable.id)}`}>
                    {consumable.name}
                  </Link>
                  <StockStatusBadge stockStatus={consumable.stockStatus} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <FloatingAddButton {...CONSUMABLE_ADD_ACTION} mobileOnly />
    </LedgerPageShell>
  );
}

export default async function ConsumablesPage() {
  const user = await requireUser();
  const { db, session } = await getD1Context(user);
  const accountState = await loadAccountState(db, session);
  if (accountState.household === null) {
    return (
      <LedgerPageShell showCategoryNavigation={false}>
        <LedgerHouseholdRequiredNotice />
      </LedgerPageShell>
    );
  }
  return <ConsumablesContent consumables={await listConsumables(db, session)} />;
}

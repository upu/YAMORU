import Link from "next/link";

import { requireUser } from "../../lib/auth/current-user";
import { listConsumables } from "../../lib/d1/consumables";
import { getD1Context } from "../../lib/d1/context";
import { loadAccountState } from "../../lib/d1/households";

export type ConsumableListItem = {
  id: string;
  name: string;
};

export function ConsumablesContent({
  consumables,
}: {
  consumables: ConsumableListItem[];
}) {
  return (
    <main className="detail-page ledger-page">
      <nav aria-label="ページ移動" className="back-nav">
        <Link href="/managed-items">← 家の台帳へ戻る</Link>
      </nav>
      <header className="detail-hero">
        <p className="detail-kicker">CONSUMABLES</p>
        <div className="detail-section-heading">
          <div>
            <h1>消耗品</h1>
            <p>家庭で使う消耗品と、いつもの品番やリンクをまとめます。</p>
          </div>
          <Link className="ledger-primary-link" href="/consumables/new">
            消耗品を登録
          </Link>
        </div>
      </header>

      <section aria-labelledby="consumables-list-title" className="detail-card">
        <h2 className="sr-only" id="consumables-list-title">登録済みの消耗品</h2>
        {consumables.length === 0 ? (
          <p className="ledger-empty">まだ消耗品はありません。</p>
        ) : (
          <ul className="ledger-list">
            {consumables.map((consumable) => (
              <li key={consumable.id}>
                <Link href={`/consumables/${encodeURIComponent(consumable.id)}`}>
                  {consumable.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export default async function ConsumablesPage() {
  const user = await requireUser();
  const { db, session } = await getD1Context(user);
  const accountState = await loadAccountState(db, session);
  if (accountState.household === null) {
    return (
      <main className="detail-page ledger-page">
        <section aria-labelledby="household-required-title" className="detail-card">
          <h1 id="household-required-title">家庭を作成してください</h1>
          <p>消耗品は家庭ごとに保存します。</p>
          <Link className="ledger-primary-link" href="/account">家庭を作成する</Link>
        </section>
      </main>
    );
  }
  return <ConsumablesContent consumables={await listConsumables(db, session)} />;
}

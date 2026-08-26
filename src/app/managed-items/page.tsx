import Link from "next/link";

import { requireUser } from "../../lib/auth/current-user";
import { getD1Context } from "../../lib/d1/context";
import { listManagedItems } from "../../lib/d1/managed-items";
import { loadAccountState } from "../../lib/d1/households";
import { FloatingAddButton } from "../floating-add-button";
import { ClassificationBadges } from "./classification-badges";

export type ManagedItemSummary = {
  id: string;
  itemTypeLabel: string | null;
  kindLabel: string;
  name: string;
};

type HouseholdSummary = { id: string; name: string };

export function ManagedItemsContent({
  household,
  items,
}: {
  household: HouseholdSummary | null;
  items: ManagedItemSummary[];
}) {
  return (
    <main className="detail-page ledger-page">
      <header className="detail-hero">
        <p className="detail-kicker">HOUSE LEDGER</p>
        <h1>家の台帳</h1>
        <p>家で管理するものと、確認に使う外部リンクをまとめます。</p>
      </header>

      {household === null ? (
        <section aria-labelledby="household-required-title" className="detail-card">
          <h2 id="household-required-title">家庭を作成してください</h2>
          <p>台帳は家庭ごとに保存します。先にアカウント画面で家庭を作成してください。</p>
          <Link className="ledger-primary-link" href="/account">
            家庭を作成する
          </Link>
        </section>
      ) : (
        <div className="ledger-grid">
          <section aria-labelledby="registered-items-title" className="detail-card">
            <p className="detail-kicker">ITEMS</p>
            <h2 id="registered-items-title">登録済みの管理対象</h2>
            {items.length === 0 ? (
              <p className="ledger-empty">
                まだ管理対象はありません。右下の「＋」ボタンから台帳に追加できます。
              </p>
            ) : (
              <ul className="ledger-list">
                {items.map((item) => (
                  <li key={item.id}>
                    <Link href={`/managed-items/${item.id}`}>{item.name}</Link>
                    <ClassificationBadges
                      itemTypeLabel={item.itemTypeLabel}
                      kindLabel={item.kindLabel}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      {household === null ? null : (
        <FloatingAddButton destination="managed-item" />
      )}
    </main>
  );
}

export default async function ManagedItemsPage() {
  const user = await requireUser();
  const { db, session } = await getD1Context(user);
  const accountState = await loadAccountState(db, session);
  const household: HouseholdSummary | null = accountState.household;
  if (household === null) {
    return <ManagedItemsContent household={null} items={[]} />;
  }

  const itemData = await listManagedItems(db, session);
  const items: ManagedItemSummary[] = itemData;

  return <ManagedItemsContent household={household} items={items} />;
}

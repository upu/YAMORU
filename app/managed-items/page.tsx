import Link from "next/link";

import { requireUser } from "../../lib/auth/current-user";
import { createClient } from "../../lib/supabase/server";
import { ManagedItemForm } from "./managed-item-form";
import {
  MANAGED_ITEM_KIND_LABELS,
  type ManagedItemKind,
  toManagedItemKind,
} from "./model";

export type ManagedItemSummary = {
  id: string;
  kind: ManagedItemKind;
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
      <nav aria-label="ページ移動" className="back-nav">
        <Link href="/">← ホームへ戻る</Link>
      </nav>

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
          <section aria-labelledby="register-item-title" className="detail-card">
            <p className="detail-kicker">ADD ITEM</p>
            <h2 id="register-item-title">管理対象を登録</h2>
            <p className="detail-note">{household.name}の台帳へ追加します。</p>
            <ManagedItemForm />
          </section>

          <section aria-labelledby="registered-items-title" className="detail-card">
            <p className="detail-kicker">ITEMS</p>
            <h2 id="registered-items-title">登録済みの管理対象</h2>
            {items.length === 0 ? (
              <p className="ledger-empty">まだ管理対象はありません。</p>
            ) : (
              <ul className="ledger-list">
                {items.map((item) => (
                  <li key={item.id}>
                    <Link href={`/managed-items/${item.id}`}>{item.name}</Link>
                    <span>{MANAGED_ITEM_KIND_LABELS[item.kind]}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

export default async function ManagedItemsPage() {
  await requireUser();
  const supabase = await createClient();
  const { data: householdData, error: householdError } = await supabase
    .from("households")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (householdError !== null) {
    throw new Error("家庭情報を取得できませんでした。");
  }

  const household: HouseholdSummary | null = householdData;
  if (household === null) {
    return <ManagedItemsContent household={null} items={[]} />;
  }

  const { data: itemData, error: itemError } = await supabase
    .from("managed_items")
    .select("id, name, kind")
    .order("created_at", { ascending: false });

  if (itemError !== null) {
    throw new Error("台帳を取得できませんでした。");
  }

  const items: ManagedItemSummary[] = itemData.map((item) => ({
    id: item.id,
    kind: toManagedItemKind(item.kind),
    name: item.name,
  }));

  return <ManagedItemsContent household={household} items={items} />;
}

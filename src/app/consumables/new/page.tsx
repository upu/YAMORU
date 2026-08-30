import Link from "next/link";

import { requireUser } from "../../../lib/auth/current-user";
import { listConsumableRelationOptions } from "../../../lib/d1/consumables";
import { getD1Context } from "../../../lib/d1/context";
import { loadAccountState } from "../../../lib/d1/households";
import { ConsumableForm } from "../consumable-form";

export default async function ConsumableRegistrationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { db, session } = await getD1Context(user);
  const accountState = await loadAccountState(db, session);
  const options = accountState.household === null
    ? { managedItems: [], taskRules: [] }
    : await listConsumableRelationOptions(db, session);
  const rawManagedItemId = (await searchParams).managedItemId;
  const initialManagedItemId = typeof rawManagedItemId === "string"
    && options.managedItems.some(({ id }) => id === rawManagedItemId)
    ? rawManagedItemId
    : undefined;

  return (
    <main className="detail-page ledger-page">
      <nav aria-label="ページ移動" className="back-nav">
        <Link href="/consumables">← 消耗品一覧へ戻る</Link>
      </nav>
      <header className="detail-hero">
        <p className="detail-kicker">ADD CONSUMABLE</p>
        <h1>消耗品を登録</h1>
      </header>
      {accountState.household === null ? (
        <section aria-labelledby="household-required-title" className="detail-card">
          <h2 id="household-required-title">家庭を作成してください</h2>
          <p>消耗品は家庭ごとに保存します。</p>
          <Link className="ledger-primary-link" href="/account">家庭を作成する</Link>
        </section>
      ) : (
        <section aria-labelledby="register-consumable-title" className="detail-card">
          <h2 id="register-consumable-title">登録内容</h2>
          <ConsumableForm
            initialManagedItemId={initialManagedItemId}
            mode="create"
            options={options}
          />
        </section>
      )}
    </main>
  );
}

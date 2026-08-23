import Link from "next/link";

import { requireUser } from "../../../lib/auth/current-user";
import { getD1Context } from "../../../lib/d1/context";
import { loadAccountState } from "../../../lib/d1/households";
import { ManagedItemForm } from "../managed-item-form";

type HouseholdSummary = { id: string; name: string };

export function ManagedItemRegistrationContent({
  household,
}: {
  household: HouseholdSummary | null;
}) {
  return (
    <main className="detail-page ledger-page">
      <nav aria-label="ページ移動" className="back-nav">
        <Link href="/managed-items">← 家の台帳へ戻る</Link>
      </nav>

      <header className="detail-hero">
        <p className="detail-kicker">ADD ITEM</p>
        <h1>管理対象を登録</h1>
        <p>家で管理するものと、確認に使う外部リンクを登録します。</p>
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
        <section aria-labelledby="register-item-title" className="detail-card">
          <h2 id="register-item-title">登録内容</h2>
          <p className="detail-note">{household.name}の台帳へ追加します。</p>
          <ManagedItemForm />
        </section>
      )}
    </main>
  );
}

export default async function ManagedItemRegistrationPage() {
  const user = await requireUser();
  const { db, session } = await getD1Context(user);
  const household: HouseholdSummary | null = (
    await loadAccountState(db, session)
  ).household;

  return <ManagedItemRegistrationContent household={household} />;
}

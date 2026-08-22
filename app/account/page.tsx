import Link from "next/link";

import { requireUser } from "../../lib/auth/current-user";
import { getD1Context } from "../../lib/d1/context";
import { loadAccountState as loadD1AccountState } from "../../lib/d1/households";
import { NicknameEditForm } from "./nickname-edit-form";
import { NicknameForm } from "./nickname-form";
import { PasswordChangePanel } from "./password-change-panel";

export default async function AccountPage() {
  const user = await requireUser();
  const { db, session } = await getD1Context(user);
  const accountState = await loadD1AccountState(db, session);
  const profile = accountState.nickname === null ? null : { nickname: accountState.nickname };

  return (
    <main className="detail-page account-page">
      <nav aria-label="ページ移動" className="back-nav">
        <Link href="/">← ホームへ戻る</Link>
      </nav>
      <header className="detail-hero">
        <p className="detail-kicker">ACCOUNT</p>
        <h1>アカウント</h1>
        <p>{user.email}</p>
      </header>
      {profile !== null ? (
        <section aria-labelledby="nickname-section-title" className="detail-card">
          <h2 id="nickname-section-title">ニックネーム</h2>
          <NicknameEditForm nickname={profile.nickname} />
        </section>
      ) : null}
      {profile === null ? (
        <section aria-labelledby="nickname-registration-title" className="detail-card">
          <h2 id="nickname-registration-title">ニックネーム登録</h2>
          <p>家庭内で表示するあなたの名前を登録してください。</p>
          <NicknameForm />
        </section>
      ) : null}
      <PasswordChangePanel />
    </main>
  );
}

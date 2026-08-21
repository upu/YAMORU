import Link from "next/link";

import { requireUser } from "../../lib/auth/current-user";
import { getD1Context } from "../../lib/d1/context";
import { loadAccountState as loadD1AccountState } from "../../lib/d1/households";
import { HouseholdForm } from "./household-form";
import { NicknameEditForm } from "./nickname-edit-form";
import { NicknameForm } from "./nickname-form";
import { PasswordChangeForm } from "./password-change-form";

export default async function AccountPage() {
  const user = await requireUser();
  const { db, session } = await getD1Context(user);
  const accountState = await loadD1AccountState(db, session);
  const household = accountState.household;
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
      <section aria-labelledby="household-state-title" className="detail-card">
        {household !== null ? (
          <>
            <h2 id="household-state-title">所属している家庭</h2>
            <p className="household-name">{household.name}</p>
            <Link className="ledger-primary-link" href="/account/invitations">
              家族を招待する
            </Link>
          </>
        ) : profile === null ? (
          <>
            <h2 id="household-state-title">ニックネーム登録</h2>
            <p>家庭を作成する前に、あなたのニックネームを登録してください。</p>
            <NicknameForm />
          </>
        ) : (
          <>
            <h2 id="household-state-title">家庭を作成</h2>
            <p>この家庭を、これから登録する管理対象やTodoの共有単位として使います。</p>
            <HouseholdForm defaultName={`${profile.nickname}の家庭`} />
          </>
        )}
      </section>
      <section aria-labelledby="password-change-title" className="detail-card">
        <h2 id="password-change-title">パスワード変更</h2>
        <p>変更後は、すべての端末で新しいパスワードによる再ログインが必要です。</p>
        <PasswordChangeForm />
      </section>
      <form action="/auth/signout" className="signout-form" method="post">
        <button className="auth-submit" type="submit">ログアウト</button>
      </form>
    </main>
  );
}

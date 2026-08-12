import Link from "next/link";

import { requireUser } from "../../lib/auth/current-user";

export default async function AccountPage() {
  const user = await requireUser();

  return (
    <main className="detail-page account-page">
      <nav aria-label="ページ移動" className="back-nav">
        <Link href="/">← ホームへ戻る</Link>
      </nav>
      <header className="detail-hero">
        <p className="detail-kicker">ACCOUNT</p>
        <h1>アカウント</h1>
        <p>{user.email ?? "メールアドレス未設定"}</p>
      </header>
      <section aria-labelledby="household-state-title" className="detail-card">
        <h2 id="household-state-title">家庭はまだ設定されていません</h2>
        <p>ログイン済みであることと、家庭への所属は別に確認します。</p>
      </section>
      <form action="/auth/signout" className="signout-form" method="post">
        <button className="auth-submit" type="submit">ログアウト</button>
      </form>
    </main>
  );
}

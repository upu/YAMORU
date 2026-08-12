import Link from "next/link";

import { requireUser } from "../../lib/auth/current-user";
import { createClient } from "../../lib/supabase/server";
import { HouseholdForm } from "./household-form";

export default async function AccountPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: household, error } = await supabase
    .from("households")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error !== null) {
    throw new Error("家庭情報を取得できませんでした。");
  }

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
        {household === null ? (
          <>
            <h2 id="household-state-title">家庭を作成</h2>
            <p>この家庭を、これから登録する管理対象やTodoの共有単位として使います。</p>
            <HouseholdForm />
          </>
        ) : (
          <>
            <h2 id="household-state-title">所属している家庭</h2>
            <p className="household-name">{household.name}</p>
          </>
        )}
      </section>
      <form action="/auth/signout" className="signout-form" method="post">
        <button className="auth-submit" type="submit">ログアウト</button>
      </form>
    </main>
  );
}

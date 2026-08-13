import Link from "next/link";

import { requireUser } from "../../lib/auth/current-user";
import { createClient } from "../../lib/supabase/server";
import { HouseholdForm } from "./household-form";
import { NicknameForm } from "./nickname-form";

type Household = { id: string; name: string };
type Profile = { nickname: string };

async function loadAccountState(userId: string) {
  const supabase = await createClient();
  const [
    { data: household, error: householdError },
    { data: profile, error: profileError },
  ] = await Promise.all([
    supabase
      .from("households")
      .select("id, name")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()
      .overrideTypes<Household, { merge: false }>(),
    supabase
      .from("profiles")
      .select("nickname")
      .eq("user_id", userId)
      .maybeSingle()
      .overrideTypes<Profile, { merge: false }>(),
  ]);

  if (householdError !== null) {
    throw new Error("家庭情報を取得できませんでした。");
  }
  if (profileError !== null) {
    throw new Error("ニックネーム情報を取得できませんでした。");
  }

  return { household, profile };
}

export default async function AccountPage() {
  const user = await requireUser();
  const { household, profile } = await loadAccountState(user.id);

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
      <form action="/auth/signout" className="signout-form" method="post">
        <button className="auth-submit" type="submit">ログアウト</button>
      </form>
    </main>
  );
}

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getCurrentUser } from "../../../../lib/auth/current-user";
import { INVITE_CLAIM_COOKIE_NAME } from "../../../../lib/invitations/claim-cookie";
import { createClient } from "../../../../lib/supabase/server";
import { NicknameForm } from "../../../account/nickname-form";
import { AcceptInvitationButton } from "./accept-invitation-button";

const CONFIRM_PATH = "/invitations/accept/confirm";

type Profile = { nickname: string };

// Issue #69 (YDR-019): 招待claimの有無「だけ」で共通エラーか続行かを分ける。
// claimの実際の有効性(無効・期限切れ・取消済み・メール不一致・一人一家庭制約)は
// ここでは判定せず、受諾ボタンを押した時点のaccept_household_invitation_by_claimへ
// 遅延させる(交換時点で無区別にした意味が、ここで再び有効性を問い合わせては
// 失われるため)。
function CommonErrorCard() {
  return (
    <section aria-labelledby="invitation-error-title" className="detail-card">
      <h2 id="invitation-error-title">この招待は開けません</h2>
      <p>
        招待リンクが無効か、有効期限が切れています。招待した家族に再発行を依頼してください。
      </p>
    </section>
  );
}

export default async function AcceptInvitationConfirmPage() {
  const cookieStore = await cookies();
  const hasClaim = cookieStore.get(INVITE_CLAIM_COOKIE_NAME) !== undefined;

  if (!hasClaim) {
    return (
      <main className="detail-page">
        <CommonErrorCard />
      </main>
    );
  }

  const user = await getCurrentUser();
  if (user === null) {
    redirect(`/login?next=${encodeURIComponent(CONFIRM_PATH)}`);
  }

  const supabase = await createClient();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("nickname")
    .eq("user_id", user.id)
    .maybeSingle()
    .overrideTypes<Profile, { merge: false }>();

  if (error !== null) {
    throw new Error("アカウント情報を取得できませんでした。");
  }

  return (
    <main className="detail-page">
      <header className="detail-hero">
        <p className="detail-kicker">INVITATION</p>
        <h1>招待を受諾</h1>
      </header>
      <section aria-labelledby="invitation-confirm-title" className="detail-card">
        {profile === null ? (
          <>
            <h2 id="invitation-confirm-title">ニックネーム登録</h2>
            <p>招待を受諾する前に、あなたのニックネームを登録してください。</p>
            <NicknameForm next={CONFIRM_PATH} />
          </>
        ) : (
          <>
            <h2 id="invitation-confirm-title">家族からの招待です</h2>
            <p>招待を受諾すると、共有家庭のホームへ移動します。</p>
            <AcceptInvitationButton />
          </>
        )}
      </section>
    </main>
  );
}

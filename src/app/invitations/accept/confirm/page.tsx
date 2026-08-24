import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getCurrentUser } from "../../../../lib/auth/current-user";
import { getD1Database } from "../../../../lib/d1/client";
import { getInvitationClaimState } from "../../../../lib/d1/invitations";
import {
  INVITE_CLAIM_COOKIE_NAME,
  INVITE_CLAIM_RESUME_PATH,
} from "../../../../lib/invitations/claim-cookie";
import { AcceptInvitationButton } from "./accept-invitation-button";
import { InvitationRegistrationForm } from "./invitation-registration-form";

// YDR-023に従い、無効・期限切れ・使用済み・取消済みを同じ表示へ畳み込む。
// 画面表示時の確認はUX用であり、メール一致や一人一家庭制約を含む最終判定は
// 受諾commit時にD1上で再検証する。
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
  const claimSecret = cookieStore.get(INVITE_CLAIM_COOKIE_NAME)?.value;

  if (claimSecret === undefined) {
    return (
      <main className="detail-page">
        <CommonErrorCard />
      </main>
    );
  }

  const db = await getD1Database();
  const claimState = await getInvitationClaimState(db, claimSecret);
  if (claimState === null) {
    return <main className="detail-page"><CommonErrorCard /></main>;
  }

  const user = await getCurrentUser();
  if (user === null && claimState.kind === "existing") {
    // claim cookieは招待パスだけへ送出する。ログインのServer Actionから
    // 確認画面へ直接戻すと、そのPOSTにはcookieが含まれず共通エラーを
    // 描画し得るため、cookieを受け取れる交換エントリーポイントを経由する。
    redirect(`/login?next=${encodeURIComponent(INVITE_CLAIM_RESUME_PATH)}`);
  }

  return (
    <main className="detail-page">
      <header className="detail-hero">
        <p className="detail-kicker">INVITATION</p>
        <h1>招待を受諾</h1>
      </header>
      <section aria-labelledby="invitation-confirm-title" className="detail-card">
        {user === null ? (
          <>
            <h2 id="invitation-confirm-title">招待からアカウントを作成</h2>
            <p>ニックネームとログイン用パスワードを設定してください。</p>
            <InvitationRegistrationForm email={claimState.email} />
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

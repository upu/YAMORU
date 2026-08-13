import Link from "next/link";

import { requireUser } from "../../../lib/auth/current-user";
import { createClient } from "../../../lib/supabase/server";
import { CancelInvitationButton } from "./cancel-invitation-button";
import { IssueInvitationForm } from "./issue-invitation-form";
import {
  INVITATION_STATUS_LABELS,
  isInvitationActionable,
  toInvitationStatus,
  type InvitationStatus,
} from "./model";

type Household = { id: string; name: string };

export type InvitationSummary = {
  createdAt: string;
  expiresAt: string;
  id: string;
  invitedEmail: string;
  status: InvitationStatus;
};

function InvitationRow({ invitation }: { invitation: InvitationSummary }) {
  return (
    <li className="invitation-row">
      <div className="invitation-row-summary">
        <span className="invitation-email">{invitation.invitedEmail}</span>
        <span className={`invitation-status invitation-status-${invitation.status}`}>
          {INVITATION_STATUS_LABELS[invitation.status]}
        </span>
      </div>
      {isInvitationActionable(invitation.status) ? (
        <div className="invitation-row-actions">
          <CancelInvitationButton invitationId={invitation.id} />
          {/* 再発行は上の発行フォームを同じメールで送信するのと同じ操作(RPC側が
              既存の有効な招待を置き換える)。フォームをこの行の中に置くと、
              再発行成功でこの行がreplacedへ変わり、結果に表示する新トークンごと
              アンマウントされてしまうため、フォームは常に表示される上のフォームへ
              誘導する。 */}
          <Link
            className="invitation-reissue-link"
            href={`/account/invitations?reissue=${encodeURIComponent(invitation.invitedEmail)}#issue-invitation-title`}
          >
            再発行する
          </Link>
        </div>
      ) : null}
    </li>
  );
}

function InvitationListSection({ invitations }: { invitations: InvitationSummary[] }) {
  return (
    <section aria-labelledby="invitation-list-title" className="detail-card">
      <p className="detail-kicker">HISTORY</p>
      <h2 id="invitation-list-title">発行済みの招待</h2>
      {invitations.length === 0 ? (
        <p className="ledger-empty">まだ招待はありません。</p>
      ) : (
        <ul className="invitation-list">
          {invitations.map((invitation) => (
            <InvitationRow invitation={invitation} key={invitation.id} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function InvitationsContent({
  defaultInviteEmail,
  household,
  invitations,
}: {
  defaultInviteEmail?: string;
  household: Household | null;
  invitations: InvitationSummary[];
}) {
  return (
    <main className="detail-page invitations-page">
      <nav aria-label="ページ移動" className="back-nav">
        <Link href="/account">← アカウントへ戻る</Link>
      </nav>

      <header className="detail-hero">
        <p className="detail-kicker">INVITATIONS</p>
        <h1>家族招待</h1>
        <p>招待リンクを発行・取消・再発行します。発行できるのは家庭メンバー全員です。</p>
      </header>

      {household === null ? (
        <section aria-labelledby="household-required-title" className="detail-card">
          <h2 id="household-required-title">家庭を作成してください</h2>
          <p>招待は家庭ごとに発行します。先にアカウント画面で家庭を作成してください。</p>
          <Link className="ledger-primary-link" href="/account">
            家庭を作成する
          </Link>
        </section>
      ) : (
        <>
          <section aria-labelledby="issue-invitation-title" className="detail-card">
            <p className="detail-kicker">INVITE</p>
            <h2 id="issue-invitation-title">招待する</h2>
            <p className="detail-note">{household.name}への招待リンクを発行します。</p>
            <IssueInvitationForm invitedEmail={defaultInviteEmail} />
          </section>

          <InvitationListSection invitations={invitations} />
        </>
      )}
    </main>
  );
}

function firstSearchParamValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function InvitationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const resolvedSearchParams = await searchParams;
  const defaultInviteEmail = firstSearchParamValue(resolvedSearchParams.reissue);

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

  const household: Household | null = householdData;
  if (household === null) {
    return <InvitationsContent household={null} invitations={[]} />;
  }

  const { data: invitationData, error: invitationError } = await supabase.rpc(
    "list_household_invitations",
  );

  if (invitationError !== null) {
    throw new Error("招待の一覧を取得できませんでした。");
  }

  const invitations: InvitationSummary[] = invitationData.map((invitation) => ({
    createdAt: invitation.created_at,
    expiresAt: invitation.expires_at,
    id: invitation.id,
    invitedEmail: invitation.invited_email,
    status: toInvitationStatus(invitation.status),
  }));

  return (
    <InvitationsContent
      defaultInviteEmail={defaultInviteEmail}
      household={household}
      invitations={invitations}
    />
  );
}

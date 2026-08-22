import Link from "next/link";

import { requireUser } from "../../lib/auth/current-user";
import { getD1Context } from "../../lib/d1/context";
import { loadAccountState } from "../../lib/d1/households";
import { listHouseholdInvitations } from "../../lib/d1/invitations";
import {
  loadHouseholdMembers,
  type HouseholdMemberOption,
} from "../../lib/d1/profiles";
import { CancelInvitationButton } from "./cancel-invitation-button";
import { HouseholdForm } from "./household-form";
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
          <Link
            className="invitation-reissue-link"
            href={`/household?reissue=${encodeURIComponent(invitation.invitedEmail)}#issue-invitation-title`}
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

type HouseholdContentProps = {
  defaultInviteEmail?: string;
  household: Household | null;
  invitations: InvitationSummary[];
  members: HouseholdMemberOption[];
  nickname: string | null;
};

function HouseholdDetails({
  defaultInviteEmail,
  household,
  invitations,
  members,
  nickname,
}: HouseholdContentProps) {
  if (nickname === null) {
    return (
      <section aria-labelledby="nickname-required-title" className="detail-card">
        <h2 id="nickname-required-title">ニックネームを登録してください</h2>
        <p>家庭を作成する前に、家庭内で表示するあなたの名前を登録します。</p>
        <Link className="ledger-primary-link" href="/account">
          アカウントで登録する
        </Link>
      </section>
    );
  }
  if (household === null) {
    return (
      <section aria-labelledby="household-create-title" className="detail-card">
        <h2 id="household-create-title">家庭を作成</h2>
        <p>この家庭を、管理対象やTodoを家族で共有する単位として使います。</p>
        <HouseholdForm defaultName={`${nickname}の家庭`} />
      </section>
    );
  }
  return (
    <div className="household-grid">
      <section aria-labelledby="household-name-title" className="detail-card">
        <p className="detail-kicker">HOUSEHOLD NAME</p>
        <h2 id="household-name-title">家庭名</h2>
        <p className="household-name">{household.name}</p>
      </section>
      <section aria-labelledby="household-members-title" className="detail-card">
        <p className="detail-kicker">MEMBERS</p>
        <h2 id="household-members-title">家族メンバー</h2>
        <ul className="household-member-list">
          {members.map((member) => <li key={member.userId}>{member.nickname}</li>)}
        </ul>
      </section>
      <section aria-labelledby="issue-invitation-title" className="detail-card">
        <p className="detail-kicker">INVITE</p>
        <h2 id="issue-invitation-title">招待する</h2>
        <p className="detail-note">{household.name}への招待リンクを発行します。</p>
        <IssueInvitationForm invitedEmail={defaultInviteEmail} />
      </section>
      <InvitationListSection invitations={invitations} />
    </div>
  );
}

export function HouseholdContent({
  defaultInviteEmail,
  household,
  invitations,
  members,
  nickname,
}: HouseholdContentProps) {
  return (
    <main className="detail-page household-page">
      <nav aria-label="ページ移動" className="back-nav">
        <Link href="/">← ホームへ戻る</Link>
      </nav>

      <header className="detail-hero">
        <p className="detail-kicker">HOUSEHOLD</p>
        <h1>家庭</h1>
        <p>家族で共有する家庭情報と招待を管理します。</p>
      </header>

      <HouseholdDetails
        defaultInviteEmail={defaultInviteEmail}
        household={household}
        invitations={invitations}
        members={members}
        nickname={nickname}
      />
    </main>
  );
}

function firstSearchParamValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function HouseholdPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const resolvedSearchParams = await searchParams;
  const defaultInviteEmail = firstSearchParamValue(resolvedSearchParams.reissue);
  const { db, session } = await getD1Context(user);
  const accountState = await loadAccountState(db, session);

  if (accountState.household === null) {
    return (
      <HouseholdContent
        household={null}
        invitations={[]}
        members={[]}
        nickname={accountState.nickname}
      />
    );
  }

  const [memberData, invitationData] = await Promise.all([
    loadHouseholdMembers(db, session),
    listHouseholdInvitations(db, session),
  ]);
  const invitations: InvitationSummary[] = invitationData.map((invitation) => ({
    createdAt: invitation.created_at,
    expiresAt: invitation.expires_at,
    id: invitation.id,
    invitedEmail: invitation.invited_email,
    status: toInvitationStatus(invitation.status),
  }));

  return (
    <HouseholdContent
      defaultInviteEmail={defaultInviteEmail}
      household={accountState.household}
      invitations={invitations}
      members={memberData}
      nickname={accountState.nickname}
    />
  );
}

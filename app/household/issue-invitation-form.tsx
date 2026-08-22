"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { PHASE_ONE_TIME_ZONE } from "../time-zone";
import { issueInvitation } from "./invitation-actions";
import { INITIAL_ISSUE_INVITATION_STATE } from "./state";

function SubmitButton({ pending }: { pending: string }) {
  const { pending: isPending } = useFormStatus();
  return (
    <button
      aria-disabled={isPending}
      className="auth-submit"
      disabled={isPending}
      type="submit"
    >
      {isPending ? pending : "招待する"}
    </button>
  );
}

function IssuedInvitationResult({
  expiresAt,
  invitedEmail,
  link,
}: {
  expiresAt: string;
  invitedEmail: string;
  link: string;
}) {
  const expiresLabel = new Date(expiresAt).toLocaleString("ja-JP", {
    timeZone: PHASE_ONE_TIME_ZONE,
  });
  return (
    <div className="invitation-issued-result" role="status">
      <p><strong>{invitedEmail}</strong>宛の招待リンクを発行しました。</p>
      <p className="invitation-link-copy">{link}</p>
      <p className="detail-note">
        このリンクは{expiresLabel}まで有効です。この画面を離れると再表示されないため、今すぐコピーして共有してください。
      </p>
    </div>
  );
}

export function IssueInvitationForm({ invitedEmail }: { invitedEmail?: string }) {
  const [state, formAction] = useActionState(
    issueInvitation,
    INITIAL_ISSUE_INVITATION_STATE,
  );

  return (
    <div className="invitation-issue-form">
      <form action={formAction} className="auth-form">
        <label htmlFor="invited-email">招待先メールアドレス</label>
        <input
          autoComplete="email"
          defaultValue={invitedEmail}
          id="invited-email"
          key={invitedEmail}
          maxLength={320}
          name="invitedEmail"
          required
          type="email"
        />
        <SubmitButton pending="発行中…" />
        {state.status === "error" ? (
          <p className="auth-feedback" role="alert">{state.message}</p>
        ) : null}
      </form>
      {state.status === "issued" ? (
        <IssuedInvitationResult
          expiresAt={state.expiresAt}
          invitedEmail={state.invitedEmail}
          link={state.link}
        />
      ) : null}
    </div>
  );
}

"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { issueInvitation } from "./actions";
import { INITIAL_ISSUE_INVITATION_STATE } from "./state";

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      aria-disabled={pending}
      className="auth-submit"
      disabled={pending}
      type="submit"
    >
      {pending ? pendingLabel : label}
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
  const expiresLabel = new Date(expiresAt).toLocaleString("ja-JP");
  return (
    <div className="invitation-issued-result" role="status">
      <p>
        <strong>{invitedEmail}</strong>宛の招待リンクを発行しました。
      </p>
      <p className="invitation-link-copy">{link}</p>
      <p className="detail-note">
        このリンクは{expiresLabel}まで有効です。この画面を離れると再表示されないため、今すぐコピーして共有してください。
      </p>
    </div>
  );
}

export function IssueInvitationForm({
  invitedEmail,
  mode,
}: {
  invitedEmail?: string;
  mode: "create" | "reissue";
}) {
  const [state, formAction] = useActionState(
    issueInvitation,
    INITIAL_ISSUE_INVITATION_STATE,
  );

  return (
    <div className="invitation-issue-form">
      <form action={formAction} className="auth-form">
        {mode === "create" ? (
          <>
            <label htmlFor="invited-email">招待先メールアドレス</label>
            <input
              autoComplete="email"
              id="invited-email"
              maxLength={320}
              name="invitedEmail"
              required
              type="email"
            />
          </>
        ) : (
          <input name="invitedEmail" type="hidden" value={invitedEmail} />
        )}
        <SubmitButton
          label={mode === "create" ? "招待する" : "再発行する"}
          pendingLabel={mode === "create" ? "発行中…" : "再発行中…"}
        />
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

"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { acceptInvitationClaim } from "./actions";
import { INITIAL_ACCEPT_INVITATION_STATE } from "./state";

const ERROR_MESSAGES: Record<"invalid", string> = {
  invalid: "この招待リンクは無効か、有効期限が切れています。招待した家族に再発行を依頼してください。",
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      aria-disabled={pending}
      className="auth-submit"
      disabled={pending}
      type="submit"
    >
      {pending ? "受諾中…" : "招待を受諾する"}
    </button>
  );
}

export function AcceptInvitationButton() {
  const [state, formAction] = useActionState(
    acceptInvitationClaim,
    INITIAL_ACCEPT_INVITATION_STATE,
  );

  if (state.status === "error") {
    return (
      <p className="auth-feedback" role="alert">
        {ERROR_MESSAGES[state.kind]}
      </p>
    );
  }

  return (
    <form action={formAction} className="auth-form">
      <SubmitButton />
    </form>
  );
}

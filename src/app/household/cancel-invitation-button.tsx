"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { cancelInvitation } from "./invitation-actions";
import styles from "./invitations.module.css";
import { INITIAL_CANCEL_INVITATION_STATE } from "./state";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      aria-disabled={pending}
      className={styles.cancelButton}
      disabled={pending}
      type="submit"
    >
      {pending ? "取消中…" : "取消する"}
    </button>
  );
}

export function CancelInvitationButton({ invitationId }: { invitationId: string }) {
  const [state, formAction] = useActionState(
    cancelInvitation,
    INITIAL_CANCEL_INVITATION_STATE,
  );

  return (
    <form action={formAction} className={styles.cancelForm}>
      <input name="invitationId" type="hidden" value={invitationId} />
      <SubmitButton />
      {state.status === "error" ? (
        <p className="auth-feedback" role="alert">{state.message}</p>
      ) : null}
    </form>
  );
}

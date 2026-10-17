"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { revokeConnectionAction } from "./actions";
import styles from "./integrations.module.css";
import { INITIAL_REVOKE_CONNECTION_STATE } from "./state";

function SubmitButton({ clientName }: { clientName: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      aria-disabled={pending}
      aria-label={`${clientName}との連携を解除する`}
      className={styles.revokeButton}
      disabled={pending}
      type="submit"
    >
      {pending ? "解除中…" : "連携を解除する"}
    </button>
  );
}

export function RevokeConnectionButton({ clientName, connectionId }: { clientName: string; connectionId: string }) {
  const [state, formAction] = useActionState(revokeConnectionAction, INITIAL_REVOKE_CONNECTION_STATE);
  return (
    <form action={formAction} className={styles.revokeForm}>
      <input name="connectionId" type="hidden" value={connectionId} />
      <SubmitButton clientName={clientName} />
      {state.status === "error" ? (
        <p className="auth-feedback" role="alert">{state.message}</p>
      ) : null}
    </form>
  );
}

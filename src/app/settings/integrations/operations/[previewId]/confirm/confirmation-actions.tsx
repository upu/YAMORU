"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { decideOperationAction } from "./actions";
import styles from "./confirm.module.css";
import { INITIAL_CONFIRM_OPERATION_STATE } from "./state";

function DecisionButton({ decision, label }: { decision: "approve" | "deny"; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      aria-disabled={pending}
      className={decision === "approve" ? "auth-submit" : styles.denyButton}
      disabled={pending}
      name="decision"
      type="submit"
      value={decision}
    >
      {label}
    </button>
  );
}

export function ConfirmationActions({ previewId }: { previewId: string }) {
  const [state, formAction] = useActionState(decideOperationAction, INITIAL_CONFIRM_OPERATION_STATE);
  if (state.status === "done") {
    return <p className="auth-feedback" role="status">{state.message}</p>;
  }
  return (
    <form action={formAction} className={styles.actions}>
      <input name="previewId" type="hidden" value={previewId} />
      <DecisionButton decision="approve" label="この内容で承認する" />
      <DecisionButton decision="deny" label="取りやめる" />
      {state.status === "error" ? <p className="auth-feedback" role="alert">{state.message}</p> : null}
    </form>
  );
}

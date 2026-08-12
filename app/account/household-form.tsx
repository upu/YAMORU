"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { createFirstHousehold } from "./actions";
import { INITIAL_HOUSEHOLD_STATE } from "./state";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      aria-disabled={pending}
      className="auth-submit"
      disabled={pending}
      type="submit"
    >
      {pending ? "作成中…" : "家庭を作成"}
    </button>
  );
}

export function HouseholdForm() {
  const [state, formAction] = useActionState(
    createFirstHousehold,
    INITIAL_HOUSEHOLD_STATE,
  );

  return (
    <form action={formAction} className="auth-form">
      <label htmlFor="household-name">家庭名</label>
      <input
        aria-describedby="household-name-help"
        autoComplete="organization"
        id="household-name"
        maxLength={100}
        name="householdName"
        required
        type="text"
      />
      <p id="household-name-help">1文字以上100文字以内で入力してください。</p>
      <SubmitButton />
      {state.status === "error" ? (
        <p className="auth-feedback" role="alert">{state.message}</p>
      ) : null}
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { MIN_PASSWORD_LENGTH } from "../../lib/auth/password-policy";
import { updatePassword, type PasswordChangeState } from "./password-actions";

const INITIAL_STATE: PasswordChangeState = { message: "", status: "idle" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="auth-submit" disabled={pending} type="submit">
      {pending ? "変更中…" : "パスワードを変更"}
    </button>
  );
}

export function PasswordChangeForm() {
  const [state, action] = useActionState(updatePassword, INITIAL_STATE);
  return (
    <form action={action} className="auth-form">
      <label htmlFor="current-password">現在のパスワード</label>
      <input
        autoComplete="current-password"
        id="current-password"
        name="currentPassword"
        required
        type="password"
      />
      <label htmlFor="new-password">新しいパスワード</label>
      <input
        autoComplete="new-password"
        id="new-password"
        minLength={MIN_PASSWORD_LENGTH}
        name="newPassword"
        required
        type="password"
      />
      <label htmlFor="new-password-confirmation">新しいパスワード（確認）</label>
      <input
        autoComplete="new-password"
        id="new-password-confirmation"
        minLength={MIN_PASSWORD_LENGTH}
        name="newPasswordConfirmation"
        required
        type="password"
      />
      <SubmitButton />
      {state.status === "error" ? <p className="auth-feedback" role="alert">{state.message}</p> : null}
    </form>
  );
}

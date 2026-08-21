"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { MIN_PASSWORD_LENGTH } from "../../../../lib/auth/password-policy";
import {
  registerFromInvitation,
  type InvitationRegistrationState,
} from "./registration-actions";

const INITIAL_STATE: InvitationRegistrationState = { message: "", status: "idle" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="auth-submit" disabled={pending} type="submit">
      {pending ? "作成中…" : "アカウントを作成して参加"}
    </button>
  );
}

export function InvitationRegistrationForm({ email }: { email: string }) {
  const [state, action] = useActionState(registerFromInvitation, INITIAL_STATE);
  return (
    <form action={action} className="auth-form">
      <label htmlFor="invitation-email">メールアドレス</label>
      <input id="invitation-email" name="email" readOnly type="email" value={email} />
      <label htmlFor="invitation-nickname">ニックネーム</label>
      <input id="invitation-nickname" maxLength={20} name="nickname" required />
      <label htmlFor="invitation-password">パスワード</label>
      <input
        autoComplete="new-password"
        id="invitation-password"
        minLength={MIN_PASSWORD_LENGTH}
        name="password"
        required
        type="password"
      />
      <label htmlFor="invitation-password-confirmation">パスワード（確認）</label>
      <input
        autoComplete="new-password"
        id="invitation-password-confirmation"
        minLength={MIN_PASSWORD_LENGTH}
        name="passwordConfirmation"
        required
        type="password"
      />
      <SubmitButton />
      {state.status === "error" ? <p className="auth-feedback" role="alert">{state.message}</p> : null}
    </form>
  );
}

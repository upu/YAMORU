"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { login } from "./actions";
import { MIN_PASSWORD_LENGTH } from "../../lib/auth/password-policy";
import { INITIAL_AUTH_STATE, type AuthActionState } from "./state";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      aria-disabled={pending}
      className="auth-submit"
      disabled={pending}
      type="submit"
    >
      {pending ? "処理中…" : label}
    </button>
  );
}

function Feedback({ state }: { state: AuthActionState }) {
  if (state.status !== "error") return null;
  return <p className="auth-feedback" role="alert">{state.message}</p>;
}

function CredentialsFields({ idPrefix }: { idPrefix: string }) {
  return (
    <>
      <label htmlFor={`${idPrefix}-email`}>メールアドレス</label>
      <input
        autoComplete="email"
        id={`${idPrefix}-email`}
        name="email"
        required
        type="email"
      />
      <label htmlFor={`${idPrefix}-password`}>パスワード</label>
      <input
        autoComplete="current-password"
        id={`${idPrefix}-password`}
        minLength={MIN_PASSWORD_LENGTH}
        name="password"
        required
        type="password"
      />
    </>
  );
}

function NextField({ next }: { next?: string }) {
  if (next === undefined) return null;
  return <input name="next" type="hidden" value={next} />;
}

export function LoginForm({ next }: { next?: string }) {
  const [loginState, loginAction] = useActionState(login, INITIAL_AUTH_STATE);

  return (
    <div className="auth-grid auth-grid-single">
      <section aria-labelledby="login-title" className="auth-card">
        <h2 id="login-title">ログイン</h2>
        <form action={loginAction} className="auth-form">
          <NextField next={next} />
          <CredentialsFields idPrefix="login" />
          <SubmitButton label="ログイン" />
          <Feedback state={loginState} />
        </form>
      </section>
    </div>
  );
}

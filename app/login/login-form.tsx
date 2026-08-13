"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { login, signup } from "./actions";
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
        autoComplete={idPrefix === "signup" ? "new-password" : "current-password"}
        id={`${idPrefix}-password`}
        minLength={6}
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
  const [signupState, signupAction] = useActionState(signup, INITIAL_AUTH_STATE);

  return (
    <div className="auth-grid">
      <section aria-labelledby="login-title" className="auth-card">
        <h2 id="login-title">ログイン</h2>
        <form action={loginAction} className="auth-form">
          <NextField next={next} />
          <CredentialsFields idPrefix="login" />
          <SubmitButton label="ログイン" />
          <Feedback state={loginState} />
        </form>
      </section>
      <section aria-labelledby="signup-title" className="auth-card">
        <h2 id="signup-title">新規登録</h2>
        <p>ローカル確認用の架空のメールアドレスを使用してください。</p>
        <form action={signupAction} className="auth-form">
          <NextField next={next} />
          <CredentialsFields idPrefix="signup" />
          <SubmitButton label="新規登録" />
          <Feedback state={signupState} />
        </form>
      </section>
    </div>
  );
}

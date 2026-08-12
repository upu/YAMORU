"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { registerNickname } from "./actions";
import { INITIAL_NICKNAME_STATE } from "./state";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      aria-disabled={pending}
      className="auth-submit"
      disabled={pending}
      type="submit"
    >
      {pending ? "登録中…" : "ニックネームを登録"}
    </button>
  );
}

export function NicknameForm() {
  const [state, formAction] = useActionState(
    registerNickname,
    INITIAL_NICKNAME_STATE,
  );

  return (
    <form action={formAction} className="auth-form">
      <label htmlFor="nickname">ニックネーム</label>
      <input
        aria-describedby="nickname-help"
        autoComplete="nickname"
        id="nickname"
        maxLength={20}
        name="nickname"
        required
        type="text"
      />
      <p id="nickname-help">1文字以上20文字以内で入力してください。</p>
      <SubmitButton />
      {state.status === "error" ? (
        <p className="auth-feedback" role="alert">{state.message}</p>
      ) : null}
    </form>
  );
}

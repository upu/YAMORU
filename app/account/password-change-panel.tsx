"use client";

import { useState } from "react";

import { PasswordChangeForm } from "./password-change-form";

export function PasswordChangePanel() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section aria-labelledby="password-change-title" className="detail-card">
      <h2 id="password-change-title">パスワード変更</h2>
      {!isOpen ? (
        <>
          <p>現在のパスワードを確認して、新しいパスワードへ変更します。</p>
          <button
            aria-expanded="false"
            className="nickname-toggle-button"
            onClick={() => {
              setIsOpen(true);
            }}
            type="button"
          >
            パスワードを変更
          </button>
        </>
      ) : (
        <>
          <p>変更後は、すべての端末で新しいパスワードによる再ログインが必要です。</p>
          <PasswordChangeForm />
          <button
            aria-expanded="true"
            className="nickname-toggle-button password-change-close"
            onClick={() => {
              setIsOpen(false);
            }}
            type="button"
          >
            閉じる
          </button>
        </>
      )}
    </section>
  );
}

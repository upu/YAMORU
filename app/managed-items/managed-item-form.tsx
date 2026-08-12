"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { createManagedItem } from "./actions";
import {
  MANAGED_ITEM_KIND_LABELS,
  MANAGED_ITEM_KINDS,
} from "./model";
import { INITIAL_MANAGED_ITEM_STATE } from "./state";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      aria-disabled={pending}
      className="auth-submit"
      disabled={pending}
      type="submit"
    >
      {pending ? "登録中…" : "管理対象を登録"}
    </button>
  );
}

export function ManagedItemForm() {
  const [state, formAction] = useActionState(
    createManagedItem,
    INITIAL_MANAGED_ITEM_STATE,
  );

  return (
    <form action={formAction} className="auth-form managed-item-form">
      <label htmlFor="managed-item-name">名前</label>
      <input
        autoComplete="off"
        id="managed-item-name"
        maxLength={100}
        name="name"
        required
        type="text"
      />

      <label htmlFor="managed-item-kind">種類</label>
      <select defaultValue="pet_supplies" id="managed-item-kind" name="kind">
        {MANAGED_ITEM_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {MANAGED_ITEM_KIND_LABELS[kind]}
          </option>
        ))}
      </select>

      <label htmlFor="managed-item-external-url">外部リンク（任意）</label>
      <input
        aria-describedby="managed-item-external-url-help"
        autoComplete="url"
        id="managed-item-external-url"
        maxLength={2048}
        name="externalUrl"
        placeholder="https://example.com/product"
        type="url"
      />
      <p id="managed-item-external-url-help">
        商品ページや説明書など、httpまたはhttpsで始まるURLを入力できます。
      </p>

      <SubmitButton />
      {state.status === "error" ? (
        <p className="auth-feedback" role="alert">{state.message}</p>
      ) : null}
    </form>
  );
}

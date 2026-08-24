"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { createManagedItem } from "./actions";
import { ManagedItemClassificationFields } from "./classification-fields";
import type { ManagedItemClassificationOptions } from "./model";
import { ManagedItemOptionalAttributeFields } from "./optional-attribute-fields";
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

export function ManagedItemForm({
  classificationOptions,
}: {
  classificationOptions: ManagedItemClassificationOptions;
}) {
  const [state, formAction] = useActionState(
    createManagedItem,
    INITIAL_MANAGED_ITEM_STATE,
  );

  return (
    <form action={formAction} className="auth-form managed-item-form">
      <label htmlFor="managed-item-name">台帳での名前</label>
      <input
        aria-describedby="managed-item-name-help"
        autoComplete="off"
        id="managed-item-name"
        maxLength={100}
        name="name"
        placeholder="例: リビングのエアコン"
        required
        type="text"
      />
      <p id="managed-item-name-help">
        家庭内でこの管理対象を見分けるための呼び名です。
      </p>

      <ManagedItemClassificationFields
        classificationOptions={classificationOptions}
        idPrefix="managed-item"
      />

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

      <ManagedItemOptionalAttributeFields idPrefix="managed-item" />

      <SubmitButton />
      {state.status === "error" ? (
        <p className="auth-feedback" role="alert">{state.message}</p>
      ) : null}
    </form>
  );
}

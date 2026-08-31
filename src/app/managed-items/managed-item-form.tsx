"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { createManagedItem } from "./actions";
import {
  defaultKindCode,
  ManagedItemClassificationFields,
  type ManagedItemCustomTypeSuggestion,
} from "./classification-fields";
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

function ManagedItemNameField() {
  return (
    <>
      <label htmlFor="managed-item-name">名前</label>
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
        家庭内でこの管理対象を見分けるための呼び名です。メーカー名や型番は下の欄に書けます。
      </p>
    </>
  );
}

export function ManagedItemForm({
  classificationOptions,
  customItemTypeOptions,
  nowIso,
}: {
  classificationOptions: ManagedItemClassificationOptions;
  customItemTypeOptions?: ManagedItemCustomTypeSuggestion[];
  nowIso?: string;
}) {
  const [state, formAction] = useActionState(
    createManagedItem,
    INITIAL_MANAGED_ITEM_STATE,
  );
  // Issue #239: 開始時期の見出し語(「購入時期」など)を選択中の大分類に
  // 合わせて切り替えるため、大分類の状態をこのフォームへ持ち上げる(YDR-033)。
  const [kindCode, setKindCode] = useState(() => defaultKindCode(classificationOptions));

  return (
    <form action={formAction} className="auth-form managed-item-form">
      <ManagedItemNameField />

      <ManagedItemClassificationFields
        classificationOptions={classificationOptions}
        customItemTypeOptions={customItemTypeOptions}
        idPrefix="managed-item"
        kindCode={kindCode}
        onKindCodeChange={setKindCode}
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

      <ManagedItemOptionalAttributeFields
        idPrefix="managed-item"
        kindCode={kindCode}
        nowIso={nowIso}
      />

      <SubmitButton />
      {state.status === "error" ? (
        <p className="auth-feedback" role="alert">{state.message}</p>
      ) : null}
    </form>
  );
}

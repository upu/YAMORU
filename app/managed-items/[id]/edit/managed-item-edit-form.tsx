"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { updateManagedItem } from "../../actions";
import {
  MANAGED_ITEM_KIND_LABELS,
  MANAGED_ITEM_KINDS,
  type ManagedItemKind,
} from "../../model";
import { INITIAL_MANAGED_ITEM_STATE } from "../../state";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      aria-disabled={pending}
      className="auth-submit"
      disabled={pending}
      type="submit"
    >
      {pending ? "保存中…" : "変更を保存"}
    </button>
  );
}

function ManagedItemEditFields({
  externalUrl,
  kind,
  name,
}: {
  externalUrl: string | null;
  kind: ManagedItemKind;
  name: string;
}) {
  return (
    <>
      <label htmlFor="managed-item-edit-name">名前</label>
      <input
        autoComplete="off"
        defaultValue={name}
        id="managed-item-edit-name"
        maxLength={100}
        name="name"
        required
        type="text"
      />

      <label htmlFor="managed-item-edit-kind">種類</label>
      <select defaultValue={kind} id="managed-item-edit-kind" name="kind">
        {MANAGED_ITEM_KINDS.map((kindOption) => (
          <option key={kindOption} value={kindOption}>
            {MANAGED_ITEM_KIND_LABELS[kindOption]}
          </option>
        ))}
      </select>

      <label htmlFor="managed-item-edit-external-url">外部リンク（任意）</label>
      <input
        aria-describedby="managed-item-edit-external-url-help"
        autoComplete="url"
        defaultValue={externalUrl ?? ""}
        id="managed-item-edit-external-url"
        maxLength={2048}
        name="externalUrl"
        placeholder="https://example.com/product"
        type="url"
      />
      <p id="managed-item-edit-external-url-help">
        商品ページや説明書など、httpまたはhttpsで始まるURLを入力できます。空にすると未設定に戻ります。
      </p>
    </>
  );
}

// Issue #40: 現在の保存内容を初期値として表示し、キャンセルで保存せず
// 詳細画面へ戻れるようにする。対象IDはactions.tsのupdateManagedItemが
// 隠しフィールドから読み取る。
export function ManagedItemEditForm({
  externalUrl,
  id,
  kind,
  name,
}: {
  externalUrl: string | null;
  id: string;
  kind: ManagedItemKind;
  name: string;
}) {
  const [state, formAction] = useActionState(
    updateManagedItem,
    INITIAL_MANAGED_ITEM_STATE,
  );

  return (
    <form action={formAction} className="auth-form managed-item-form">
      <input name="id" type="hidden" value={id} />
      <ManagedItemEditFields externalUrl={externalUrl} kind={kind} name={name} />
      <div className="nickname-edit-actions">
        <SubmitButton />
        <Link
          className="nickname-toggle-button"
          href={`/managed-items/${encodeURIComponent(id)}`}
        >
          キャンセル
        </Link>
      </div>
      {state.status === "error" ? (
        <p className="auth-feedback" role="alert">{state.message}</p>
      ) : null}
    </form>
  );
}

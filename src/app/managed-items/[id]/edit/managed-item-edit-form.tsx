"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { updateManagedItem } from "../../actions";
import { ManagedItemClassificationFields } from "../../classification-fields";
import type { ManagedItemClassificationOptions } from "../../model";
import { ManagedItemOptionalAttributeFields } from "../../optional-attribute-fields";
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

type ManagedItemEditFieldValues = {
  customItemType: string | null;
  externalUrl: string | null;
  itemTypeCode: string | null;
  kindCode: string;
  name: string;
  note: string | null;
  productInfo: string | null;
  startedOn: string | null;
};

function ManagedItemNameField({ name }: { name: string }) {
  return (
    <>
      <label htmlFor="managed-item-edit-name">名前</label>
      <input
        aria-describedby="managed-item-edit-name-help"
        autoComplete="off"
        defaultValue={name}
        id="managed-item-edit-name"
        maxLength={100}
        name="name"
        placeholder="例: リビングのエアコン"
        required
        type="text"
      />
      <p id="managed-item-edit-name-help">
        家庭内でこの管理対象を見分けるための呼び名です。メーカー名や型番は下の欄に書けます。
      </p>
    </>
  );
}

function ManagedItemExternalUrlField({ externalUrl }: { externalUrl: string | null }) {
  return (
    <>
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

function ManagedItemEditFields({
  classificationOptions,
  customItemType,
  externalUrl,
  itemTypeCode,
  kindCode,
  name,
  note,
  nowIso,
  productInfo,
  startedOn,
}: ManagedItemEditFieldValues & {
  classificationOptions: ManagedItemClassificationOptions;
  nowIso?: string;
}) {
  // Issue #239: 開始時期の見出し語(「購入時期」など)を選択中の大分類に
  // 合わせて切り替えるため、大分類の状態をこのフォームへ持ち上げる(YDR-033)。
  // 初期値は保存済みのkindCode。
  const [currentKindCode, setCurrentKindCode] = useState(kindCode);
  return (
    <>
      <ManagedItemNameField name={name} />

      <ManagedItemClassificationFields
        classificationOptions={classificationOptions}
        idPrefix="managed-item-edit"
        initialCustomItemType={customItemType}
        initialItemTypeCode={itemTypeCode}
        kindCode={currentKindCode}
        onKindCodeChange={setCurrentKindCode}
      />

      <ManagedItemExternalUrlField externalUrl={externalUrl} />

      <ManagedItemOptionalAttributeFields
        idPrefix="managed-item-edit"
        kindCode={currentKindCode}
        note={note}
        nowIso={nowIso}
        productInfo={productInfo}
        startedOn={startedOn}
      />
    </>
  );
}

// Issue #40: 現在の保存内容を初期値として表示し、キャンセルで保存せず
// 詳細画面へ戻れるようにする。対象IDはactions.tsのupdateManagedItemが
// 隠しフィールドから読み取る。
export function ManagedItemEditForm({
  classificationOptions,
  id,
  nowIso,
  ...values
}: ManagedItemEditFieldValues & {
  classificationOptions: ManagedItemClassificationOptions;
  id: string;
  nowIso?: string;
}) {
  const [state, formAction] = useActionState(
    updateManagedItem,
    INITIAL_MANAGED_ITEM_STATE,
  );

  return (
    <form action={formAction} className="auth-form managed-item-form">
      <input name="id" type="hidden" value={id} />
      <ManagedItemEditFields
        classificationOptions={classificationOptions}
        nowIso={nowIso}
        {...values}
      />
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

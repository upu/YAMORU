"use client";

import { useState } from "react";

import type { ManagedItemClassificationOptions } from "./model";

const CUSTOM_ITEM_TYPE_VALUE = "__custom__";

function ClassificationSelects({
  classificationOptions,
  idPrefix,
  itemTypeValue,
  kindCode,
  onItemTypeChange,
  onKindChange,
}: {
  classificationOptions: ManagedItemClassificationOptions;
  idPrefix: string;
  itemTypeValue: string;
  kindCode: string;
  onItemTypeChange: (value: string) => void;
  onKindChange: (value: string) => void;
}) {
  const itemTypes = classificationOptions.itemTypes.filter(
    (itemType) => itemType.kindCode === kindCode,
  );
  return (
    <>
      <label htmlFor={`${idPrefix}-kind`}>大分類</label>
      <select
        id={`${idPrefix}-kind`}
        name="kindCode"
        onChange={(event) => { onKindChange(event.target.value); }}
        required
        value={kindCode}
      >
        {classificationOptions.kinds.map((kind) => (
          <option key={kind.code} value={kind.code}>{kind.label}</option>
        ))}
      </select>

      <label htmlFor={`${idPrefix}-item-type`}>詳しい種類（任意）</label>
      <select
        id={`${idPrefix}-item-type`}
        name="itemTypeCode"
        onChange={(event) => { onItemTypeChange(event.target.value); }}
        value={itemTypeValue}
      >
        <option value="">指定しない</option>
        {itemTypes.map((itemType) => (
          <option key={itemType.code} value={itemType.code}>{itemType.label}</option>
        ))}
        <option value={CUSTOM_ITEM_TYPE_VALUE}>その他（自由入力）</option>
      </select>
    </>
  );
}

// Issue #239: 大分類は開始時期(started_on)の見出し語も左右するため、選択中の
// 大分類を親フォームへ持ち上げられるよう、kindCodeを外部から制御する
// (controlled)値として受け取る。詳しい種類はこの画面の中だけで完結するため
// 従来どおり内部状態のまま持つ。
export function defaultKindCode(
  classificationOptions: ManagedItemClassificationOptions,
): string {
  return classificationOptions.kinds.find(({ code }) => code === "asset")?.code
    ?? classificationOptions.kinds.at(0)?.code
    ?? "";
}

export function ManagedItemClassificationFields({
  classificationOptions,
  idPrefix,
  initialCustomItemType = null,
  initialItemTypeCode = null,
  kindCode,
  onKindCodeChange,
}: {
  classificationOptions: ManagedItemClassificationOptions;
  idPrefix: string;
  initialCustomItemType?: string | null;
  initialItemTypeCode?: string | null;
  kindCode: string;
  onKindCodeChange: (value: string) => void;
}) {
  const [itemTypeValue, setItemTypeValue] = useState(
    initialCustomItemType === null
      ? (initialItemTypeCode ?? "")
      : CUSTOM_ITEM_TYPE_VALUE,
  );
  return (
    <>
      <ClassificationSelects
        classificationOptions={classificationOptions}
        idPrefix={idPrefix}
        itemTypeValue={itemTypeValue}
        kindCode={kindCode}
        onItemTypeChange={setItemTypeValue}
        onKindChange={(value) => {
          onKindCodeChange(value);
          setItemTypeValue("");
        }}
      />

      {itemTypeValue === CUSTOM_ITEM_TYPE_VALUE ? (
        <>
          <label htmlFor={`${idPrefix}-custom-item-type`}>詳しい種類を入力</label>
          <input
            autoComplete="off"
            defaultValue={initialCustomItemType ?? ""}
            id={`${idPrefix}-custom-item-type`}
            maxLength={50}
            name="customItemType"
            required
            type="text"
          />
        </>
      ) : null}
    </>
  );
}

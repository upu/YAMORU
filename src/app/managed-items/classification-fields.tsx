"use client";

import { useState } from "react";

import {
  type ManagedItemClassificationOptions,
  normalizeItemTypeText,
} from "./model";

const CUSTOM_ITEM_TYPE_VALUE = "__custom__";

// Issue #288: 登録・編集画面で入力補助に使う、家庭内で使用中の自由入力の
// 詳しい種類。src/lib/d1/managed-items.tsのManagedItemCustomTypeOptionと
// 同じ形だが、一覧の絞り込み候補(ManagedItemTypeGroup)と同じく、画面側は
// 表示に必要な形だけを受け取る。
export type ManagedItemCustomTypeSuggestion = { kindCode: string; label: string };

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

function describeCustomItemTypeSuggestions(
  suggestionCount: number,
  visibleCount: number,
): string {
  if (suggestionCount === 0) {
    return "この大分類で使用中の自由入力の種類はまだありません。新しい種類として入力できます。";
  }
  if (visibleCount === 0) {
    return "入力中の文字に一致する使用中の種類はありません。新しい種類として入力できます。";
  }
  return `使用中の種類が${String(visibleCount)}件あります。選ぶと入力欄へ入ります。`;
}

// Issue #288: 「その他（自由入力）」を選んだとき、同じ家庭で使用中の自由入力
// 種類を候補として並べ、押すと入力欄へ入れられるようにする(表記揺れを増やし
// にくくする)。候補は選択中の大分類のものだけに絞る。プリセットの詳しい種類が
// 大分類で絞り込まれるのと同じ見え方に揃え、登録フォームを長くしないため。
// 候補選択は必須にせず、候補にない種類はこれまでどおりそのまま入力できる。
//
// 候補UIは、datalist案・検索欄付きの候補一覧案(ManagedItemTypePicker)とも
// 比べた上で「入力欄の下にボタンを並べる」案を採った。datalistはブラウザーに
// よって候補の見え方と読み上げが揃わず「候補を確認できる」ことを保証しにくく、
// ManagedItemTypePickerは1文字以上の入力を前提にした絞り込み用(Issue #268)で、
// 自由入力欄と二重の入力欄になる。件数が増えたときは、一覧の候補と同じ
// スクロール領域(managed-item-results)に収める。
function CustomItemTypeField({
  idPrefix,
  initialValue,
  suggestions,
}: {
  idPrefix: string;
  initialValue: string;
  suggestions: ManagedItemCustomTypeSuggestion[];
}) {
  const [value, setValue] = useState(initialValue);
  const inputId = `${idPrefix}-custom-item-type`;
  const statusId = `${inputId}-status`;
  const normalizedValue = normalizeItemTypeText(value);
  const visibleSuggestions = normalizedValue === ""
    ? suggestions
    : suggestions.filter(
      (suggestion) => normalizeItemTypeText(suggestion.label).includes(normalizedValue),
    );
  const status = describeCustomItemTypeSuggestions(
    suggestions.length,
    visibleSuggestions.length,
  );

  return (
    <>
      <label htmlFor={inputId}>詳しい種類を入力</label>
      <input
        aria-describedby={statusId}
        autoComplete="off"
        id={inputId}
        maxLength={50}
        name="customItemType"
        onChange={(event) => { setValue(event.currentTarget.value); }}
        required
        type="text"
        value={value}
      />
      {visibleSuggestions.length === 0 ? null : (
        <div
          aria-label="使用中の詳しい種類から選ぶ"
          className="managed-item-results custom-item-type-suggestions"
          role="group"
        >
          {visibleSuggestions.map((suggestion) => (
            <button
              className="custom-item-type-suggestion"
              key={suggestion.label}
              onClick={() => { setValue(suggestion.label); }}
              type="button"
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      )}
      <p aria-live="polite" className="input-help" id={statusId}>{status}</p>
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
  customItemTypeOptions = [],
  idPrefix,
  initialCustomItemType = null,
  initialItemTypeCode = null,
  kindCode,
  onKindCodeChange,
}: {
  classificationOptions: ManagedItemClassificationOptions;
  customItemTypeOptions?: ManagedItemCustomTypeSuggestion[];
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
        <CustomItemTypeField
          idPrefix={idPrefix}
          initialValue={initialCustomItemType ?? ""}
          suggestions={customItemTypeOptions.filter(
            (option) => option.kindCode === kindCode,
          )}
        />
      ) : null}
    </>
  );
}

"use client";

import { useId, useState } from "react";

import { normalizeItemTypeText } from "./model";

// Issue #238: 台帳一覧の「詳しい種類」絞り込みを、プリセットと家庭内で使用中の
// 自由入力値を同じ候補一覧から選べる検索可能な単一選択欄にする(issue本文の
// 設計メモの案1)。/todosのManagedItemSearch(#96)と同じ「テキストで候補を
// 絞り、ラジオボタンで1件選ぶ」形を土台にする。Issue #268: 一文字以上
// 入力したときだけ一致候補を出し、選択時は親フォーム
// からURLへ即時反映する。JavaScript無効時の選択肢は親フォームのnoscriptに
// 分け、初期画面で全候補を並べない要件とフォールバックを両立する。
export type ManagedItemTypeOption = {
  isCustom: boolean;
  label: string;
  value: string;
};

export type ManagedItemTypeGroup = {
  kindCode: string;
  kindLabel: string;
  options: ManagedItemTypeOption[];
};

const ALL_VALUE = "";

function matchesQuery(option: ManagedItemTypeOption, normalizedQuery: string): boolean {
  return normalizeItemTypeText(option.label).includes(normalizedQuery);
}

function getVisibleGroups(
  groups: ManagedItemTypeGroup[],
  normalizedQuery: string,
): ManagedItemTypeGroup[] {
  return groups
    .map((group) => ({
      ...group,
      options: group.options.filter((option) => matchesQuery(option, normalizedQuery)),
    }))
    .filter((group) => group.options.length > 0);
}

function countOptions(groups: ManagedItemTypeGroup[]): number {
  return groups.reduce((total, group) => total + group.options.length, 0);
}

function describeItemTypeSearch(normalizedQuery: string, visibleCount: number): string {
  if (normalizedQuery === "") {
    return "詳しい種類の候補は閉じています。1文字以上入力すると表示します。";
  }
  if (visibleCount === 0) return "一致する詳しい種類がありません。";
  return `${String(visibleCount)}件見つかりました。`;
}

function ItemTypeOptions({
  groups,
  idPrefix,
  onSelect,
  selectedValue,
}: {
  groups: ManagedItemTypeGroup[];
  idPrefix: string;
  onSelect: (value: string) => void;
  selectedValue: string;
}) {
  return (
    <>
      <label className="radio-option">
        <input
          checked={selectedValue === ALL_VALUE}
          name={`${idPrefix}-choice`}
          onChange={() => { onSelect(ALL_VALUE); }}
          type="radio"
          value={ALL_VALUE}
        />
        すべて
      </label>
      {groups.map((group) => (
        <fieldset className="todo-fieldset" key={group.kindCode}>
          <legend>{group.kindLabel}</legend>
          {group.options.map((option) => (
            <label className="radio-option" key={option.value}>
              <input
                checked={selectedValue === option.value}
                name={`${idPrefix}-choice`}
                onChange={() => { onSelect(option.value); }}
                type="radio"
                value={option.value}
              />
              {option.label}{option.isCustom ? "（自由入力）" : ""}
            </label>
          ))}
        </fieldset>
      ))}
    </>
  );
}

export function ManagedItemTypePicker({
  groups,
  idPrefix,
  initialValue,
  onSelect,
}: {
  groups: ManagedItemTypeGroup[];
  idPrefix: string;
  initialValue: string;
  onSelect: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedValue, setSelectedValue] = useState(initialValue);
  const queryInputId = useId();
  const normalizedQuery = normalizeItemTypeText(query);
  const hasQuery = normalizedQuery !== "";
  const visibleGroups = hasQuery ? getVisibleGroups(groups, normalizedQuery) : [];
  const status = describeItemTypeSearch(normalizedQuery, countOptions(visibleGroups));
  const resultsId = `${idPrefix}-${queryInputId}-results`;
  const statusId = `${idPrefix}-${queryInputId}-status`;

  function select(value: string) {
    setSelectedValue(value);
    onSelect(value);
  }

  return (
    <fieldset aria-label="詳しい種類で絞り込み" className="ledger-item-type-picker">
      <label className="sr-only" htmlFor={`${idPrefix}-${queryInputId}`}>詳しい種類の一部を入力</label>
      <input
        aria-controls={hasQuery ? resultsId : undefined}
        aria-describedby={statusId}
        autoComplete="off"
        id={`${idPrefix}-${queryInputId}`}
        onChange={(event) => { setQuery(event.currentTarget.value); }}
        placeholder="詳しい種類の一部を入力"
        type="search"
        value={query}
      />

      {hasQuery ? (
        <div aria-label="詳しい種類の候補" className="managed-item-results" id={resultsId}>
          <ItemTypeOptions
            groups={visibleGroups}
            idPrefix={idPrefix}
            onSelect={select}
            selectedValue={selectedValue}
          />
        </div>
      ) : null}
      <p aria-live="polite" className={hasQuery ? "input-help" : "sr-only"} id={statusId}>
        {status}
      </p>
    </fieldset>
  );
}

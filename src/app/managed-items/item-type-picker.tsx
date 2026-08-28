"use client";

import { useId, useState } from "react";

// Issue #238: 台帳一覧の「詳しい種類」絞り込みを、プリセットと家庭内で使用中の
// 自由入力値を同じ候補一覧から選べる検索可能な単一選択欄にする(issue本文の
// 設計メモの案1)。/todosのManagedItemSearch(#96)と同じ「テキストで候補を
// 絞り、ラジオボタンで1件選ぶ」形にすると、name属性を持つ<input type="radio">
// がそのままGETフォームの一部として送信されるため、JSが動かない場合でも
// 候補を直接クリックして絞り込みを送信できる(選び直しの絞り込み検索だけが
// JS前提の拡張)。
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

function normalizeQuery(value: string): string {
  return value.trim().toLocaleLowerCase("ja-JP");
}

function matchesQuery(option: ManagedItemTypeOption, normalizedQuery: string): boolean {
  return normalizedQuery === "" || option.label.toLocaleLowerCase("ja-JP").includes(normalizedQuery);
}

// 選択中の候補は、検索語に一致しなくても候補から消さない(送信されなくなる
// ことを防ぐと同時に、選択中であることが分かるようにする、/todosの
// ManagedItemSearchのgetVisibleManagedItemsと同じ考え方)。
function getVisibleGroups(
  groups: ManagedItemTypeGroup[],
  normalizedQuery: string,
  selectedValue: string,
): ManagedItemTypeGroup[] {
  return groups
    .map((group) => ({
      ...group,
      options: group.options.filter(
        (option) => matchesQuery(option, normalizedQuery) || option.value === selectedValue,
      ),
    }))
    .filter((group) => group.options.length > 0);
}

function countOptions(groups: ManagedItemTypeGroup[]): number {
  return groups.reduce((total, group) => total + group.options.length, 0);
}

function describeItemTypeSearch(normalizedQuery: string, visibleCount: number): string {
  if (normalizedQuery === "") return "";
  if (visibleCount === 0) return "一致する詳しい種類がありません。";
  return `${String(visibleCount)}件見つかりました。`;
}

export function ManagedItemTypePicker({
  groups,
  idPrefix,
  initialValue,
}: {
  groups: ManagedItemTypeGroup[];
  idPrefix: string;
  initialValue: string;
}) {
  const [query, setQuery] = useState("");
  const [selectedValue, setSelectedValue] = useState(initialValue);
  const queryInputId = useId();
  const normalizedQuery = normalizeQuery(query);
  const visibleGroups = getVisibleGroups(groups, normalizedQuery, selectedValue);
  const status = describeItemTypeSearch(normalizedQuery, countOptions(visibleGroups));

  return (
    <fieldset aria-label="詳しい種類で絞り込み" className="ledger-item-type-picker">
      <label className="sr-only" htmlFor={`${idPrefix}-${queryInputId}`}>詳しい種類の一部を入力</label>
      <input
        autoComplete="off"
        id={`${idPrefix}-${queryInputId}`}
        onChange={(event) => { setQuery(event.currentTarget.value); }}
        placeholder="詳しい種類の一部を入力"
        type="search"
        value={query}
      />

      <div className="managed-item-results">
        <label className="radio-option">
          <input
            checked={selectedValue === ALL_VALUE}
            name="itemType"
            onChange={() => { setSelectedValue(ALL_VALUE); }}
            type="radio"
            value={ALL_VALUE}
          />
          すべて
        </label>
        {visibleGroups.map((group) => (
          <fieldset className="todo-fieldset" key={group.kindCode}>
            <legend>{group.kindLabel}</legend>
            {group.options.map((option) => (
              <label className="radio-option" key={option.value}>
                <input
                  checked={selectedValue === option.value}
                  name="itemType"
                  onChange={() => { setSelectedValue(option.value); }}
                  type="radio"
                  value={option.value}
                />
                {option.label}
                {option.isCustom ? "（自由入力）" : ""}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <p aria-live="polite" className="input-help">{status}</p>
    </fieldset>
  );
}

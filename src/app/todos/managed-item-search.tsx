"use client";

import { useState } from "react";

export type TodoManagedItemOption = { id: string; name: string };

const MANAGED_ITEM_RESULT_LIMIT = 10;

function getVisibleManagedItems(
  matches: TodoManagedItemOption[],
  selectedItem: TodoManagedItemOption | undefined,
): TodoManagedItemOption[] {
  if (selectedItem === undefined || matches.some((item) => item.id === selectedItem.id)) {
    return matches.slice(0, MANAGED_ITEM_RESULT_LIMIT);
  }
  return [
    selectedItem,
    ...matches
      .filter((item) => item.id !== selectedItem.id)
      .slice(0, MANAGED_ITEM_RESULT_LIMIT - 1),
  ];
}

function describeManagedItemSearch(
  normalizedQuery: string,
  matches: TodoManagedItemOption[],
  selectedItem: TodoManagedItemOption | undefined,
): string {
  if (normalizedQuery.length === 0) {
    return selectedItem === undefined
      ? "関連付ける場合だけ、管理対象の名前を入力してください。"
      : `${selectedItem.name}を選択しています。`;
  }
  if (matches.length === 0) return "一致する管理対象がありません。";
  if (matches.length > MANAGED_ITEM_RESULT_LIMIT) {
    return `${String(matches.length)}件中、先頭の${String(MANAGED_ITEM_RESULT_LIMIT)}件を表示しています。`;
  }
  return `${String(matches.length)}件見つかりました。`;
}

function ManagedItemResults({
  items,
  selectedId,
  setSelectedId,
}: {
  items: TodoManagedItemOption[];
  selectedId: string;
  setSelectedId: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div aria-label="検索結果" className="managed-item-results" role="group">
      {items.map((item) => (
        <label className="radio-option" key={item.id}>
          <input
            checked={selectedId === item.id}
            name="managedItemId"
            onChange={() => { setSelectedId(item.id); }}
            type="radio"
            value={item.id}
          />
          {item.name}
        </label>
      ))}
    </div>
  );
}

// Todo登録(#96)とTodo編集(#203)で同じ選び方を使う。家庭の管理対象が増えても
// 一覧を全部並べず、名前の一部で絞り込んでから選ぶ。選択中の管理対象は、
// 検索語に一致しなくても候補の先頭に残す。
export function ManagedItemSearch({
  idPrefix,
  initialManagedItemId,
  managedItems,
}: {
  idPrefix: string;
  initialManagedItemId: string | null;
  managedItems: TodoManagedItemOption[];
}) {
  const validInitialId = managedItems.some((item) => item.id === initialManagedItemId)
    ? initialManagedItemId ?? ""
    : "";
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(validInitialId);
  const searchId = `${idPrefix}-managed-item-search`;
  const normalizedQuery = query.trim().toLocaleLowerCase("ja-JP");
  const matches = normalizedQuery.length === 0
    ? []
    : managedItems.filter((item) =>
        item.name.toLocaleLowerCase("ja-JP").includes(normalizedQuery)
      );
  const selectedItem = managedItems.find((item) => item.id === selectedId);
  const visibleItems = getVisibleManagedItems(matches, selectedItem);
  const status = describeManagedItemSearch(normalizedQuery, matches, selectedItem);

  return (
    <fieldset className="todo-fieldset managed-item-picker">
      <legend>関連する管理対象（任意）</legend>
      <label className="radio-option">
        <input
          checked={selectedId === ""}
          name="managedItemId"
          onChange={() => { setSelectedId(""); }}
          type="radio"
          value=""
        />
        関連する管理対象なし
      </label>
      <label htmlFor={searchId}>管理対象を検索</label>
      <input
        autoComplete="off"
        id={searchId}
        onChange={(event) => { setQuery(event.currentTarget.value); }}
        placeholder="名前の一部を入力"
        type="search"
        value={query}
      />
      <ManagedItemResults
        items={visibleItems}
        selectedId={selectedId}
        setSelectedId={setSelectedId}
      />
      <p aria-live="polite" className="input-help">
        {status}
      </p>
    </fieldset>
  );
}

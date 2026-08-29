"use client";

import type { SyntheticEvent } from "react";
import { useRouter } from "next/navigation";

import { ManagedItemTypePicker, type ManagedItemTypeGroup } from "./item-type-picker";
import { buildManagedItemsHref } from "./search-href";

function normalizeSearch(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function KindSelect({
  initialValue,
  kinds,
  onSelect,
}: {
  initialValue: string;
  kinds: { code: string; label: string }[];
  onSelect: (value: string) => void;
}) {
  return (
    <>
      <label className="sr-only" htmlFor="managed-items-search-kind">大分類で絞り込み</label>
      <select
        defaultValue={initialValue}
        id="managed-items-search-kind"
        name="kind"
        onChange={(event) => { onSelect(event.currentTarget.value); }}
      >
        <option value="">大分類: すべて</option>
        {kinds.map((option) => (
          <option key={option.code} value={option.code}>{option.label}</option>
        ))}
      </select>
    </>
  );
}

function NoScriptItemTypeFilter({
  groups,
  initialValue,
}: {
  groups: ManagedItemTypeGroup[];
  initialValue: string;
}) {
  return (
    <noscript>
      <div className="ledger-search-fallback">
        <label htmlFor="managed-items-search-item-type-fallback">詳しい種類で絞り込み</label>
        <select
          defaultValue={initialValue}
          id="managed-items-search-item-type-fallback"
          name="itemType"
        >
          <option value="">詳しい種類: すべて</option>
          {groups.map((group) => (
            <optgroup key={group.kindCode} label={group.kindLabel}>
              {group.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}{option.isCustom ? "（自由入力）" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button type="submit">分類の変更を反映</button>
      </div>
    </noscript>
  );
}

export function ManagedItemsSearchForm({
  itemTypeGroups,
  itemTypeRaw,
  kind,
  kinds,
  q,
}: {
  itemTypeGroups: ManagedItemTypeGroup[];
  itemTypeRaw: string;
  kind: string | undefined;
  kinds: { code: string; label: string }[];
  q: string | undefined;
}) {
  const router = useRouter();
  const searchId = "managed-items-search-q";

  function navigate(nextItemType: string, nextKind: string, nextQ: string | undefined) {
    router.push(buildManagedItemsHref(
      nextItemType === "" ? undefined : nextItemType,
      nextKind === "" ? undefined : nextKind,
      nextQ,
    ));
  }

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    navigate(itemTypeRaw, kind ?? "", normalizeSearch(data.get("q")));
  }

  return (
    <form
      action="/managed-items"
      aria-label="台帳を検索・絞り込み"
      className="auth-form ledger-search-form"
      method="get"
      onSubmit={handleSubmit}
    >
      <label className="sr-only" htmlFor={searchId}>管理対象名で検索</label>
      <input
        defaultValue={q ?? ""}
        id={searchId}
        name="q"
        placeholder="名前の一部を入力"
        type="search"
      />

      <KindSelect
        initialValue={kind ?? ""}
        kinds={kinds}
        onSelect={(value) => { navigate(itemTypeRaw, value, q); }}
      />
      <ManagedItemTypePicker
        groups={itemTypeGroups}
        idPrefix="managed-items-search-item-type"
        initialValue={itemTypeRaw}
        onSelect={(value) => { navigate(value, kind ?? "", q); }}
      />

      <button type="submit">名前を検索</button>

      <NoScriptItemTypeFilter groups={itemTypeGroups} initialValue={itemTypeRaw} />
    </form>
  );
}

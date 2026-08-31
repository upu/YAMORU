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

const SEARCH_TITLE_ID = "managed-items-search-title";
const SEARCH_QUERY_ID = "managed-items-search-q";

// Issue #285: 検索・絞り込み領域の役割を画面上の言葉で示す見出し。フォームの
// アクセシブルな名前も兼ねる(aria-labelledby)ので、支援技術でも同じ言葉で
// 領域を識別できる。
function SearchFormTitle() {
  return <h3 className="ledger-search-title" id={SEARCH_TITLE_ID}>検索・絞り込み</h3>;
}

// Issue #285: 管理対象名の入力欄。placeholderも「登録する名前」と読めない
// 表現にし、上の見出しと合わせて検索用であることを伝える。
function NameSearchField({ q }: { q: string | undefined }) {
  return (
    <>
      <label className="sr-only" htmlFor={SEARCH_QUERY_ID}>管理対象名で検索</label>
      <input
        defaultValue={q ?? ""}
        id={SEARCH_QUERY_ID}
        name="q"
        placeholder="名前で検索"
        type="search"
      />
    </>
  );
}

// Issue #285: 検索・絞り込み領域に短い見出しを表示する(issue本文の設計メモの
// 第一候補)。初見の利用者が管理対象名の入力欄を「登録する名前」の欄と誤認した
// ため、領域の役割を画面上の言葉で先に示す。見出しはフォームのアクセシブルな
// 名前も兼ねる(aria-labelledby)ので、支援技術でも同じ言葉で領域を識別できる。
// 別案のモバイル限定の開閉(details)は、Issue #218からの検索自体の発見性を
// 下げうるため採らない。1行の見出しを足すだけなら、モバイルでも一覧確認を
// 邪魔するほど常時大きくならない。
export function ManagedItemsSearchForm({
  itemTypeGroups,
  itemTypeRaw,
  kind,
  q,
}: {
  itemTypeGroups: ManagedItemTypeGroup[];
  itemTypeRaw: string;
  kind: string;
  q: string | undefined;
}) {
  const router = useRouter();

  function navigate(nextItemType: string, nextQ: string | undefined) {
    router.push(buildManagedItemsHref(
      nextItemType === "" ? undefined : nextItemType,
      kind,
      nextQ,
    ));
  }

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    navigate(itemTypeRaw, normalizeSearch(data.get("q")));
  }

  return (
    <form
      action="/managed-items"
      aria-labelledby={SEARCH_TITLE_ID}
      className="auth-form ledger-search-form"
      method="get"
      onSubmit={handleSubmit}
    >
      <SearchFormTitle />

      <NameSearchField q={q} />
      {/* JavaScript無効時の検索でも、台帳上部で選んだ入口を保つ。 */}
      <input name="kind" type="hidden" value={kind} />
      <ManagedItemTypePicker
        groups={itemTypeGroups}
        idPrefix="managed-items-search-item-type"
        initialValue={itemTypeRaw}
        onSelect={(value) => { navigate(value, q); }}
      />

      <button type="submit">名前を検索</button>

      <NoScriptItemTypeFilter groups={itemTypeGroups} initialValue={itemTypeRaw} />
    </form>
  );
}

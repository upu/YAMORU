"use client";

import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { DialogShell } from "../dialog-shell";
import type { ConsumableCandidateResult } from "./relation-actions";

// Issue #292: 消耗品の関連付けを、未選択も含む全件チェックリストから
// 「選択済みだけを常に表示し、追加するときに検索して選ぶ」構成へ変える。
// 管理対象とTodoで同じ操作になるよう、単位の呼び名(unit)と候補の表示文
// (describe)、候補の検索関数(search)だけを差し替えて共有する。
export type RelationCandidate = { id: string };

// 入力のたびにサーバーへ問い合わせないための待ち時間。空文字(ダイアログを
// 開いた直後の初期候補)は待たずに取得する。
const SEARCH_DEBOUNCE_MS = 250;

const UNEXPECTED_ERROR_MESSAGE = "候補を取得できませんでした。時間をおいて再度お試しください。";

type CandidateState<T> =
  | { hasMore: boolean; items: T[]; phase: "ready" }
  | { message: string; phase: "error" }
  | { phase: "loading" };

type CandidateSearch<T> = (query: string) => Promise<ConsumableCandidateResult<T>>;

// 検索語が変わるたびに前回の取得を打ち切り、遅れて届いた結果で新しい結果を
// 上書きしないようにする(activeフラグ)。reloadKeyは失敗後の再試行で増やす。
function useCandidates<T>(
  query: string,
  reloadKey: number,
  search: CandidateSearch<T>,
): CandidateState<T> {
  const [state, setState] = useState<CandidateState<T>>({ phase: "loading" });

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setState({ phase: "loading" });
      void search(query).then((result) => {
        if (!active) return;
        setState(result.status === "ok"
          ? { hasMore: result.hasMore, items: result.items, phase: "ready" }
          : { message: result.message, phase: "error" });
      }).catch(() => {
        if (active) setState({ message: UNEXPECTED_ERROR_MESSAGE, phase: "error" });
      });
    }, query === "" ? 0 : SEARCH_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, reloadKey, search]);

  return state;
}

function describeCandidates<T>(state: CandidateState<T>, unit: string): string {
  if (state.phase === "loading") return `${unit}の候補を探しています…`;
  if (state.phase === "error") return state.message;
  if (state.items.length === 0) return `一致する${unit}がありません。`;
  // 上限で区切られたときは、いま並べている件数がそのまま上限になる。
  if (state.hasMore) {
    return `候補が多いため、先頭の${String(state.items.length)}件を表示しています。`
      + "名前を入力すると絞り込めます。";
  }
  return `${String(state.items.length)}件見つかりました。`;
}

function CandidateList<T extends RelationCandidate>({
  describe,
  items,
  onToggle,
  selectedIds,
  unit,
}: {
  describe: (item: T) => string;
  items: T[];
  onToggle: (item: T) => void;
  selectedIds: Set<string>;
  unit: string;
}) {
  if (items.length === 0) return null;
  return (
    <div aria-label={`${unit}の候補`} className="managed-item-results" role="group">
      {items.map((item) => (
        <label className="filter-option" key={item.id}>
          <input
            checked={selectedIds.has(item.id)}
            onChange={() => { onToggle(item); }}
            type="checkbox"
          />
          <span>{describe(item)}</span>
        </label>
      ))}
    </div>
  );
}

// ダイアログはフォームの内側に描画されるため、検索欄のEnterで消耗品フォームが
// 送信されないようにする。
function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === "Enter") event.preventDefault();
}

function CandidateSearchField({
  fieldId,
  onChange,
  query,
  searchRef,
  unit,
}: {
  fieldId: string;
  onChange: (query: string) => void;
  query: string;
  searchRef: RefObject<HTMLInputElement | null>;
  unit: string;
}) {
  return (
    <>
      <label htmlFor={`${fieldId}-search`}>{unit}を検索</label>
      <input
        aria-describedby={`${fieldId}-status`}
        autoComplete="off"
        id={`${fieldId}-search`}
        onChange={(event) => { onChange(event.currentTarget.value); }}
        onKeyDown={handleSearchKeyDown}
        placeholder="名前の一部を入力"
        ref={searchRef}
        type="search"
        value={query}
      />
    </>
  );
}

function RelationPickerDialog<T extends RelationCandidate>({
  describe,
  onClose,
  onToggle,
  search,
  selectedIds,
  unit,
}: {
  describe: (item: T) => string;
  onClose: () => void;
  onToggle: (item: T) => void;
  search: CandidateSearch<T>;
  selectedIds: Set<string>;
  unit: string;
}) {
  const [query, setQuery] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const state = useCandidates(query, reloadKey, search);

  useEffect(() => { searchRef.current?.focus(); }, []);

  return (
    <DialogShell
      kicker="ADD RELATION"
      onClose={onClose}
      title={`${unit}を追加`}
      titleId={`${fieldId}-title`}
    >
      <div className="relation-picker">
        <CandidateSearchField
          fieldId={fieldId}
          onChange={setQuery}
          query={query}
          searchRef={searchRef}
          unit={unit}
        />
        <CandidateList
          describe={describe}
          items={state.phase === "ready" ? state.items : []}
          onToggle={onToggle}
          selectedIds={selectedIds}
          unit={unit}
        />
        <p aria-live="polite" className="input-help" id={`${fieldId}-status`}>
          {describeCandidates(state, unit)}
        </p>
        {state.phase === "error" ? (
          <button onClick={() => { setReloadKey((key) => key + 1); }} type="button">
            再試行
          </button>
        ) : null}
        <button className="relation-picker-done" onClick={onClose} type="button">
          選択を終える
        </button>
      </div>
    </DialogShell>
  );
}

function SelectedRelations<T extends RelationCandidate>({
  describe,
  fieldName,
  items,
  onRemove,
  unit,
}: {
  describe: (item: T) => string;
  fieldName: string;
  items: T[];
  onRemove: (id: string) => void;
  unit: string;
}) {
  if (items.length === 0) {
    return <p className="input-help">関連付けている{unit}はありません。</p>;
  }
  return (
    <ul className="relation-chip-list">
      {items.map((item) => (
        <li className="relation-chip" key={item.id}>
          <span>{describe(item)}</span>
          <button
            aria-label={`${describe(item)}を関連から外す`}
            className="relation-chip-remove"
            onClick={() => { onRemove(item.id); }}
            type="button"
          >
            <span aria-hidden="true">×</span>
          </button>
          <input name={fieldName} type="hidden" value={item.id} />
        </li>
      ))}
    </ul>
  );
}

// 選択件数はlegendにも出すが、legendの変化は読み上げられないため、
// 追加・解除のたびに件数を伝えるライブリージョンを添える。
function AddRelationTrigger({
  count,
  onOpen,
  triggerRef,
  unit,
}: {
  count: number;
  onOpen: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  unit: string;
}) {
  return (
    <>
      <p aria-live="polite" className="sr-only">
        関連する{unit}を{count}件選択しています。
      </p>
      <button className="relation-add-trigger" onClick={onOpen} ref={triggerRef} type="button">
        ＋ {unit}を追加
      </button>
    </>
  );
}

export function ConsumableRelationField<T extends RelationCandidate>({
  describe,
  fieldName,
  items,
  onChange,
  search,
  unit,
}: {
  describe: (item: T) => string;
  fieldName: string;
  items: T[];
  onChange: (items: T[]) => void;
  search: CandidateSearch<T>;
  unit: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedIds = new Set(items.map((item) => item.id));

  function close() {
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  function toggle(item: T) {
    onChange(selectedIds.has(item.id)
      ? items.filter((selected) => selected.id !== item.id)
      : [...items, item]);
  }

  return (
    <fieldset className="consumable-relations">
      <legend>関連する{unit}（{items.length}件・任意）</legend>
      <SelectedRelations
        describe={describe}
        fieldName={fieldName}
        items={items}
        onRemove={(id) => { onChange(items.filter((item) => item.id !== id)); }}
        unit={unit}
      />
      <AddRelationTrigger
        count={items.length}
        onOpen={() => { setIsOpen(true); }}
        triggerRef={triggerRef}
        unit={unit}
      />
      {isOpen ? (
        <RelationPickerDialog
          describe={describe}
          onClose={close}
          onToggle={toggle}
          search={search}
          selectedIds={selectedIds}
          unit={unit}
        />
      ) : null}
    </fieldset>
  );
}

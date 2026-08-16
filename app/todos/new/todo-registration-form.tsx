"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { INITIAL_MAINTENANCE_TODO_STATE } from "../../managed-items/[id]/state";
import { PHASE_ONE_TIME_ZONE } from "../../time-zone";
import { createTodo } from "./actions";

export type TodoManagedItemOption = { id: string; name: string };
const MANAGED_ITEM_RESULT_LIMIT = 10;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="auth-submit" disabled={pending} type="submit">
      {pending ? "登録中…" : "Todoを登録"}
    </button>
  );
}

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

function ManagedItemSearch({
  initialManagedItemId,
  managedItems,
}: {
  initialManagedItemId: string | null;
  managedItems: TodoManagedItemOption[];
}) {
  const validInitialId = managedItems.some((item) => item.id === initialManagedItemId)
    ? initialManagedItemId ?? ""
    : "";
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(validInitialId);
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
      <label htmlFor="managed-item-search">管理対象を検索</label>
      <input
        autoComplete="off"
        id="managed-item-search"
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

function RecurrenceFields({
  recurrenceBasis,
  setRecurrenceBasis,
}: {
  recurrenceBasis: "completion" | "once";
  setRecurrenceBasis: (value: "completion" | "once") => void;
}) {
  return (
    <fieldset className="todo-fieldset">
      <legend>繰り返し方</legend>
      <label className="radio-option">
        <input
          checked={recurrenceBasis === "once"}
          name="recurrenceBasis"
          onChange={() => { setRecurrenceBasis("once"); }}
          type="radio"
          value="once"
        />
        繰り返しなし
      </label>
      <label className="radio-option">
        <input
          checked={recurrenceBasis === "completion"}
          name="recurrenceBasis"
          onChange={() => { setRecurrenceBasis("completion"); }}
          type="radio"
          value="completion"
        />
        完了した日から繰り返す
      </label>
    </fieldset>
  );
}

function OneTimeFields() {
  return (
    <div className="todo-fieldset">
      <label htmlFor="todo-planned-date">予定日</label>
      <input id="todo-planned-date" name="plannedDate" required type="date" />
      <p className="input-help">完了しても次のTodoは作成されません。</p>
    </div>
  );
}

function IntervalFields() {
  const [intervalMin, setIntervalMin] = useState("1");
  const [intervalMax, setIntervalMax] = useState("2");
  const [intervalUnit, setIntervalUnit] = useState<"day" | "week">("week");
  const unitLabel = intervalUnit === "week" ? "週間後" : "日後";

  return (
    <fieldset className="todo-fieldset">
      <legend>次回の目安</legend>
      <div className="interval-fields">
        <label htmlFor="todo-interval-min">最短</label>
        <input
          id="todo-interval-min"
          min={0}
          name="intervalMin"
          onChange={(event) => { setIntervalMin(event.currentTarget.value); }}
          required
          step={1}
          type="number"
          value={intervalMin}
        />
        <span aria-hidden="true">〜</span>
        <label htmlFor="todo-interval-max">最長</label>
        <input
          id="todo-interval-max"
          min={0}
          name="intervalMax"
          onChange={(event) => { setIntervalMax(event.currentTarget.value); }}
          required
          step={1}
          type="number"
          value={intervalMax}
        />
        <label htmlFor="todo-interval-unit">単位</label>
        <select
          id="todo-interval-unit"
          name="intervalUnit"
          onChange={(event) => {
            setIntervalUnit(event.currentTarget.value as "day" | "week");
          }}
          value={intervalUnit}
        >
          <option value="day">日後</option>
          <option value="week">週間後</option>
        </select>
      </div>
      <p className="input-help">
        完了すると、その日から{intervalMin}〜{intervalMax}{unitLabel}が次回の目安になります。
      </p>
    </fieldset>
  );
}

function InitialDateFields() {
  const [mode, setMode] = useState<"next_window_start" | "previous_completion">(
    "previous_completion",
  );
  return (
    <fieldset className="todo-fieldset">
      <legend>初回の決め方</legend>
      <label className="radio-option">
        <input
          checked={mode === "previous_completion"}
          name="initialDateMode"
          onChange={() => { setMode("previous_completion"); }}
          type="radio"
          value="previous_completion"
        />
        前回実施日から計算する
      </label>
      <label className="radio-option">
        <input
          checked={mode === "next_window_start"}
          name="initialDateMode"
          onChange={() => { setMode("next_window_start"); }}
          type="radio"
          value="next_window_start"
        />
        次回の目安開始日を指定する
      </label>
      <label htmlFor="todo-anchor-date">
        {mode === "previous_completion" ? "前回実施日" : "次回の目安開始日"}
      </label>
      <input id="todo-anchor-date" name="anchorDate" required type="date" />
      <p className="input-help">
        {mode === "previous_completion"
          ? "入力した実施日から、初回の目安を自動計算します。"
          : "目安の上限日は、指定した開始日から自動計算します。"}
      </p>
    </fieldset>
  );
}

export function TodoRegistrationForm({
  initialManagedItemId,
  managedItems,
}: {
  initialManagedItemId: string | null;
  managedItems: TodoManagedItemOption[];
}) {
  const [recurrenceBasis, setRecurrenceBasis] = useState<"completion" | "once">("once");
  const [state, formAction] = useActionState(
    createTodo,
    INITIAL_MAINTENANCE_TODO_STATE,
  );

  return (
    <form aria-label="Todo登録フォーム" action={formAction} className="auth-form maintenance-todo-form">
      <label htmlFor="todo-title">Todo名</label>
      <input
        autoComplete="off"
        id="todo-title"
        maxLength={100}
        name="title"
        placeholder="換気扇の掃除"
        required
        type="text"
      />

      <RecurrenceFields
        recurrenceBasis={recurrenceBasis}
        setRecurrenceBasis={setRecurrenceBasis}
      />
      {recurrenceBasis === "once" ? (
        <OneTimeFields />
      ) : (
        <>
          <IntervalFields />
          <InitialDateFields />
        </>
      )}
      <ManagedItemSearch
        initialManagedItemId={initialManagedItemId}
        managedItems={managedItems}
      />

      <p>
        家庭のタイムゾーンは{PHASE_ONE_TIME_ZONE}（日本時間）として保存・表示します。
      </p>
      <SubmitButton />
      {state.status === "idle" ? null : (
        <p
          className={`auth-feedback${state.status === "success" ? " todo-success" : ""}`}
          role="status"
        >
          {state.message}
        </p>
      )}
    </form>
  );
}

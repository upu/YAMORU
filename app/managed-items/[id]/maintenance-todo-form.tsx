"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { createMaintenanceTodo } from "./actions";
import { INITIAL_MAINTENANCE_TODO_STATE } from "./state";
import { PHASE_ONE_TIME_ZONE } from "../../time-zone";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      aria-disabled={pending}
      className="auth-submit"
      disabled={pending}
      type="submit"
    >
      {pending ? "登録中…" : "メンテナンスTodoを登録"}
    </button>
  );
}

function IntervalPreview({
  intervalMax,
  intervalMin,
  intervalUnit,
}: {
  intervalMax: string;
  intervalMin: string;
  intervalUnit: "day" | "week";
}) {
  const unitLabel = intervalUnit === "week" ? "週間後" : "日後";
  return (
    <p className="input-help">
      完了すると、その日から{intervalMin}〜{intervalMax}{unitLabel}が次回の目安になります。
    </p>
  );
}

function IntervalNumberInput({
  id,
  label,
  name,
  onChange,
  value,
}: {
  id: string;
  label: string;
  name: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        min={0}
        name={name}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        required
        step={1}
        type="number"
        value={value}
      />
    </>
  );
}

function IntervalFields({
  intervalMax,
  intervalMin,
  intervalUnit,
  setIntervalMax,
  setIntervalMin,
  setIntervalUnit,
}: {
  intervalMax: string;
  intervalMin: string;
  intervalUnit: "day" | "week";
  setIntervalMax: (value: string) => void;
  setIntervalMin: (value: string) => void;
  setIntervalUnit: (value: "day" | "week") => void;
}) {
  return (
    <fieldset className="todo-fieldset">
      <legend>次回の目安</legend>
      <div className="interval-fields">
        <IntervalNumberInput
          id="interval-min"
          label="最短"
          name="intervalMin"
          onChange={setIntervalMin}
          value={intervalMin}
        />
        <span aria-hidden="true">〜</span>
        <IntervalNumberInput
          id="interval-max"
          label="最長"
          name="intervalMax"
          onChange={setIntervalMax}
          value={intervalMax}
        />
        <label htmlFor="interval-unit">単位</label>
        <select
          id="interval-unit"
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
      <IntervalPreview
        intervalMax={intervalMax}
        intervalMin={intervalMin}
        intervalUnit={intervalUnit}
      />
    </fieldset>
  );
}

function InitialDateFields() {
  const [mode, setMode] = useState<"previous_completion" | "next_window_start">(
    "previous_completion",
  );
  return (
    <fieldset className="todo-fieldset">
      <legend>初回の決め方</legend>
      <label className="radio-option">
        <input
          checked={mode === "previous_completion"}
          name="initialDateMode"
          onChange={() => {
            setMode("previous_completion");
          }}
          type="radio"
          value="previous_completion"
        />
        前回実施日から計算する
      </label>
      <label className="radio-option">
        <input
          checked={mode === "next_window_start"}
          name="initialDateMode"
          onChange={() => {
            setMode("next_window_start");
          }}
          type="radio"
          value="next_window_start"
        />
        次回の目安開始日を指定する
      </label>
      <label htmlFor="anchor-date">
        {mode === "previous_completion" ? "前回実施日" : "次回の目安開始日"}
      </label>
      <input id="anchor-date" name="anchorDate" required type="date" />
      <p className="input-help">
        {mode === "previous_completion"
          ? "入力した実施日から、初回の目安を自動計算します。"
          : "目安の上限日は、指定した開始日から自動計算します。"}
      </p>
    </fieldset>
  );
}

export function MaintenanceTodoForm({ managedItemId }: { managedItemId: string }) {
  const [intervalMin, setIntervalMin] = useState("1");
  const [intervalMax, setIntervalMax] = useState("2");
  const [intervalUnit, setIntervalUnit] = useState<"day" | "week">("week");
  const action = createMaintenanceTodo.bind(null, managedItemId);
  const [state, formAction] = useActionState(
    action,
    INITIAL_MAINTENANCE_TODO_STATE,
  );

  return (
    <form action={formAction} className="auth-form maintenance-todo-form">
      <label htmlFor="maintenance-todo-title">Todo名</label>
      <input
        autoComplete="off"
        id="maintenance-todo-title"
        maxLength={100}
        name="title"
        placeholder="フィルター交換"
        required
        type="text"
      />

      <div className="repeat-summary">
        <span>繰り返し方</span>
        <strong>完了した日から繰り返す</strong>
      </div>

      <IntervalFields
        intervalMax={intervalMax}
        intervalMin={intervalMin}
        intervalUnit={intervalUnit}
        setIntervalMax={setIntervalMax}
        setIntervalMin={setIntervalMin}
        setIntervalUnit={setIntervalUnit}
      />
      <InitialDateFields />

      <p>
        Phase 1では家庭のタイムゾーンを{PHASE_ONE_TIME_ZONE}（日本時間）として保存・表示します。
      </p>

      <SubmitButton />
      {state.status !== "idle" ? (
        <p
          className={`auth-feedback${state.status === "success" ? " todo-success" : ""}`}
          role="status"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

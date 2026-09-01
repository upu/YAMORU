"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { INITIAL_MAINTENANCE_TODO_STATE } from "../../managed-items/[id]/state";
import type {
  RegisteredTodoSummary,
  TodoRegistrationState,
} from "./registration-feedback";
import {
  ManagedItemSearch,
  type TodoManagedItemOption,
} from "../managed-item-search";
import { createTodo } from "./actions";
import {
  CalendarFields,
  FixedIntervalFields,
  InitialDateFields,
  IntervalFields,
  OneTimeFields,
} from "./recurrence-fields";

export type { TodoManagedItemOption };

type RecurrenceBasis = "calendar" | "completion" | "interval" | "once";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="auth-submit" disabled={pending} type="submit">
      {pending ? "登録中…" : "Todoを登録"}
    </button>
  );
}

// Issue #99 / YDR-037の8: 完了日基準と固定間隔は入力の見た目が似ているため、
// 遅れて完了したときの違いを選択肢ごとの補足文で示す。補足のない選択肢は
// 名前だけで意味が伝わるもの(繰り返しなし・曜日・日付)。
const RECURRENCE_OPTIONS: {
  help: string | null;
  label: string;
  value: RecurrenceBasis;
}[] = [
  { help: null, label: "繰り返しなし", value: "once" },
  {
    help: "完了した日を起点に次回を決めます。遅れて完了すると、その分だけ次回も後ろへずれます。",
    label: "完了した日から繰り返す",
    value: "completion",
  },
  {
    help: "起点日から一定の間隔で予定します。遅れて完了しても周期はずれません。",
    label: "一定の間隔で繰り返す",
    value: "interval",
  },
  { help: null, label: "曜日・日付で繰り返す", value: "calendar" },
];

function RecurrenceFields({
  recurrenceBasis,
  setRecurrenceBasis,
}: {
  recurrenceBasis: RecurrenceBasis;
  setRecurrenceBasis: (value: RecurrenceBasis) => void;
}) {
  return (
    <fieldset className="todo-fieldset">
      <legend>繰り返し方</legend>
      {RECURRENCE_OPTIONS.map((option) => (
        <div key={option.value}>
          <label className="radio-option">
            <input
              checked={recurrenceBasis === option.value}
              name="recurrenceBasis"
              onChange={() => { setRecurrenceBasis(option.value); }}
              type="radio"
              value={option.value}
            />
            {option.label}
          </label>
          {option.help === null
            ? null
            : <p className="input-help">{option.help}</p>}
        </div>
      ))}
    </fieldset>
  );
}

// Issue #286: 登録できたことに加えて、次回の予定と確認先をその場で示す。
// ホームは「いま対応すること」に絞る役割(Issue #201)を変えないため、
// 直後にホームへ出ないTodoでは、いつ出るかとTodo一覧への導線を添える。
function TodoRegistrationFeedback({
  message,
  registered,
  status,
}: {
  message: string;
  registered: RegisteredTodoSummary | undefined;
  status: "error" | "idle" | "success";
}) {
  if (status === "idle") return null;
  if (status === "error") {
    return <p className="auth-feedback" role="status">{message}</p>;
  }
  return (
    <div className="todo-registration-feedback" role="status">
      <p className="auth-feedback todo-success">{message}</p>
      {registered === undefined ? null : (
        <>
          <p className="todo-registration-schedule">{registered.schedule}</p>
          {registered.homeNotice === null
            ? null
            : <p className="input-help">{registered.homeNotice}</p>}
          <Link className="todo-registration-link" href="/todos">
            登録したTodoを一覧で確認
          </Link>
        </>
      )}
    </div>
  );
}

export function TodoRegistrationForm({
  initialManagedItemId,
  managedItems,
}: {
  initialManagedItemId: string | null;
  managedItems: TodoManagedItemOption[];
}) {
  const [recurrenceBasis, setRecurrenceBasis] = useState<RecurrenceBasis>("once");
  const [state, formAction] = useActionState<TodoRegistrationState, FormData>(
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
      {recurrenceBasis === "once" ? <OneTimeFields /> : null}
      {recurrenceBasis === "completion" ? (
        <>
          <IntervalFields />
          <InitialDateFields />
        </>
      ) : null}
      {recurrenceBasis === "interval" ? <FixedIntervalFields /> : null}
      {recurrenceBasis === "calendar" ? <CalendarFields /> : null}
      <ManagedItemSearch
        idPrefix="todo"
        initialManagedItemId={initialManagedItemId}
        managedItems={managedItems}
      />

      <SubmitButton />
      <TodoRegistrationFeedback
        message={state.message}
        registered={state.registered}
        status={state.status}
      />
    </form>
  );
}

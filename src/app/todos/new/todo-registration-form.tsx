"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { INITIAL_MAINTENANCE_TODO_STATE } from "../../../features/todos/state";
import type {
  RegisteredTodoSummary,
  TodoRegistrationState,
} from "./registration-feedback";
import {
  ManagedItemSearch,
  type TodoManagedItemOption,
} from "../managed-item-search";
import { useRefresh } from "../../refresh-coordinator";
import { createTodo } from "./actions";
import { CalendarFields } from "./calendar-fields";
import {
  FixedIntervalFields,
  InitialDateFields,
  IntervalFields,
  OneTimeFields,
} from "./recurrence-fields";
import styles from "./registration-notice.module.css";

export type { TodoManagedItemOption };

type RecurrenceBasis = "calendar" | "completion" | "interval" | "manual" | "once";

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
  {
    // Issue #325 / YDR-046: コーヒーマシーンの石灰除去など、実施時期を
    // YAMORU側では決められない繰り返し作業のための方式。
    help: "日付は決めず、必要になったときに実施します。完了すると次回分が自動で用意されます。",
    label: "必要になったら繰り返す",
    value: "manual",
  },
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
//
// Issue #326: この通知は登録ボタンの直下ではなく、画面上部へ固定して出す。
// スマホでフォーム下部まで進んで登録すると、ボタンの下に出た通知が画面の外に
// あることがあり、登録できたことに気づけなかった。短時間で消えるToastには
// せず、次回予定と一覧への導線を確認し終えるまで残し、閉じる操作で消す。
// モーダルにもしないため、通知が出ている間もフォームの操作を続けられる。
function TodoRegistrationNotice({
  message,
  onDismiss,
  registered,
}: {
  message: string;
  onDismiss: () => void;
  registered: RegisteredTodoSummary | undefined;
}) {
  // 更新結果の通知も同じ位置(画面上部)へ出る。自動では消えないこの通知が
  // 「更新できませんでした」と「再試行」を覆わないよう、出ている間は下へ積む。
  const { status: refreshStatus } = useRefresh();
  const stacked = refreshStatus === "error" || refreshStatus === "success";
  const className = stacked
    ? `${styles.notice} ${styles.belowRefreshNotice}`
    : styles.notice;

  return (
    <div className={className} role="status">
      <div className={styles.heading}>
        <p className={styles.message}>{message}</p>
        <button
          aria-label="登録の通知を閉じる"
          className={styles.dismiss}
          onClick={onDismiss}
          type="button"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {registered === undefined ? null : (
        <>
          <p className={styles.schedule}>{registered.schedule}</p>
          {registered.homeNotice === null ? null : (
            <p className={`input-help ${styles.homeNotice}`}>{registered.homeNotice}</p>
          )}
          <Link className={styles.link} href="/todos">
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
  const [state, formAction, isPending] = useActionState<TodoRegistrationState, FormData>(
    createTodo,
    INITIAL_MAINTENANCE_TODO_STATE,
  );
  // Issue #326: 閉じた通知を覚えておく。useActionStateは登録のたびに新しい
  // 状態を返すため、次の登録では別の値になり通知がまた出る。送信中は前回の
  // 「登録しました」を残さない。
  const [dismissed, setDismissed] = useState<TodoRegistrationState | null>(null);
  const showNotice = state.status === "success" && state !== dismissed && !isPending;

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
      {/* 入力のやり直しに使う失敗の理由は、これまでどおり登録ボタンの近くに
      置く。上部へ動かすと、直す対象の入力欄から離れてしまう。 */}
      {state.status === "error" ? (
        <p className="auth-feedback" role="status">{state.message}</p>
      ) : null}
      {showNotice ? (
        <TodoRegistrationNotice
          message={state.message}
          onDismiss={() => { setDismissed(state); }}
          registered={state.registered}
        />
      ) : null}
    </form>
  );
}

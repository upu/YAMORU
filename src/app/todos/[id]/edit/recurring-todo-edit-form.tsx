"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { type AssigneeOption } from "../../../assignee";
import { INITIAL_MAINTENANCE_TODO_STATE } from "../../../managed-items/[id]/state";
import {
  ManagedItemSearch,
  type TodoManagedItemOption,
} from "../../managed-item-search";
import { WEEKDAY_OPTIONS, WeekdayCheckboxes } from "../../weekday-checkboxes";
import { MonthlyWeekPositionCheckboxes } from "../../monthly-week-position-checkboxes";
import { updateRecurringOccurrence, updateRecurringRule } from "../actions";
import { AssigneeField, SubmitButton } from "./todo-edit-form";

type CalendarRuleValues = {
  managedItemId: string | null;
  recurrenceBasis: "calendar";
  scheduleDayOfMonth: number | null;
  // Issue #100 / #102 / YDR-040: 毎週は複数曜日、月次の曜日方式は1曜日を持つ。
  scheduleDaysOfWeek: number[];
  scheduleKind: "monthly_day" | "monthly_nth_weekday" | "weekly" | "yearly";
  scheduleMonth: number | null;
  scheduleMonthEnd: boolean;
  scheduleWeekLast?: boolean;
  scheduleWeekOfMonth: number | null;
  scheduleWeeksOfMonth?: number[];
  title: string;
};

type CompletionRuleValues = {
  managedItemId: string | null;
  recurrenceBasis: "completion";
  recommendedStartValue: number;
  recommendedUnit: "day" | "month" | "week" | "year";
  recommendedUntilValue: number;
  title: string;
};

type IntervalRuleValues = {
  intervalAnchorOn: string;
  intervalCount: number;
  intervalUnit: "day" | "week";
  managedItemId: string | null;
  recurrenceBasis: "interval";
  title: string;
};

export type RecurringRuleEditValues =
  | CalendarRuleValues
  | CompletionRuleValues
  | IntervalRuleValues;

type RecurringOccurrenceValues = {
  assigneeUserId: string | null;
  dueDate: string;
  scheduledDate: string;
};

function FormFeedback({ state }: { state: typeof INITIAL_MAINTENANCE_TODO_STATE }) {
  return state.status === "error"
    ? <p className="auth-feedback" role="alert">{state.message}</p>
    : null;
}

function WeekdayField({ value }: { value: number | null }) {
  return (
    <>
      <label htmlFor="recurring-rule-weekday">曜日</label>
      <select defaultValue={String(value ?? 1)} id="recurring-rule-weekday" name="scheduleDayOfWeek">
        {WEEKDAY_OPTIONS.map(([weekday, label]) => (
          <option key={weekday} value={weekday}>{label}</option>
        ))}
      </select>
    </>
  );
}

function MonthlyDayFields({ rule }: { rule: CalendarRuleValues }) {
  const [monthEnd, setMonthEnd] = useState(rule.scheduleMonthEnd);
  return (
    <>
      <label className="radio-option">
        <input checked={!monthEnd} name="scheduleDayMode" onChange={() => { setMonthEnd(false); }} type="radio" />
        日付を指定
      </label>
      <label className="radio-option">
        <input checked={monthEnd} name="scheduleDayMode" onChange={() => { setMonthEnd(true); }} type="radio" />
        毎月末
      </label>
      {monthEnd ? <input name="scheduleMonthEnd" type="hidden" value="1" /> : (
        <>
          <label htmlFor="recurring-rule-day">日付</label>
          <input defaultValue={rule.scheduleDayOfMonth ?? 1} id="recurring-rule-day" max={31} min={1} name="scheduleDayOfMonth" required type="number" />
        </>
      )}
    </>
  );
}

function MonthlyNthWeekdayFields({ rule }: { rule: CalendarRuleValues }) {
  return (
    <>
      <MonthlyWeekPositionCheckboxes
        defaultLast={rule.scheduleWeekLast}
        defaultSelected={rule.scheduleWeeksOfMonth ??
          (rule.scheduleWeekOfMonth === null ? [] : [rule.scheduleWeekOfMonth])}
      />
      <WeekdayField value={rule.scheduleDaysOfWeek.at(0) ?? null} />
      <p className="input-help">
        第5曜日がない月はその月をスキップし、最終は毎月の最後の曜日を選びます。
      </p>
    </>
  );
}

function YearlyFields({ rule }: { rule: CalendarRuleValues }) {
  return (
    <>
      <label htmlFor="recurring-rule-month">月</label>
      <select defaultValue={String(rule.scheduleMonth ?? 1)} id="recurring-rule-month" name="scheduleMonth">
        {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
          <option key={month} value={month}>{month}月</option>
        ))}
      </select>
      <label htmlFor="recurring-rule-day">日付</label>
      <input defaultValue={rule.scheduleDayOfMonth ?? 1} id="recurring-rule-day" max={31} min={1} name="scheduleDayOfMonth" required type="number" />
    </>
  );
}

type CalendarPattern = "monthly" | "weekly" | "yearly";
type MonthlyMode = "monthly_day" | "monthly_nth_weekday";

function MonthlyRuleFields({ rule }: { rule: CalendarRuleValues }) {
  const initialMode = rule.scheduleKind === "monthly_nth_weekday"
    ? "monthly_nth_weekday"
    : "monthly_day";
  const [mode, setMode] = useState<MonthlyMode>(initialMode);
  return (
    <>
      <fieldset className="todo-fieldset">
        <legend>毎月の指定方法</legend>
        <label className="radio-option">
          <input
            checked={mode === "monthly_day"}
            name="scheduleKind"
            onChange={() => { setMode("monthly_day"); }}
            type="radio"
            value="monthly_day"
          />
          日付で指定
        </label>
        <label className="radio-option">
          <input
            checked={mode === "monthly_nth_weekday"}
            name="scheduleKind"
            onChange={() => { setMode("monthly_nth_weekday"); }}
            type="radio"
            value="monthly_nth_weekday"
          />
          曜日で指定
        </label>
      </fieldset>
      {mode === "monthly_day"
        ? <MonthlyDayFields rule={rule} />
        : <MonthlyNthWeekdayFields rule={rule} />}
    </>
  );
}

function patternForKind(kind: CalendarRuleValues["scheduleKind"]): CalendarPattern {
  if (kind === "monthly_day" || kind === "monthly_nth_weekday") return "monthly";
  return kind;
}

function CalendarRuleFields({ rule }: { rule: CalendarRuleValues }) {
  const [pattern, setPattern] = useState<CalendarPattern>(patternForKind(rule.scheduleKind));
  return (
    <fieldset className="todo-fieldset">
      <legend>定例日</legend>
      <label htmlFor="recurring-rule-kind">定例パターン</label>
      <select
        id="recurring-rule-kind"
        name="calendarPattern"
        onChange={(event) => { setPattern(event.currentTarget.value as CalendarPattern); }}
        value={pattern}
      >
        <option value="weekly">毎週</option>
        <option value="monthly">毎月</option>
        <option value="yearly">毎年の月日</option>
      </select>
      {pattern === "weekly"
        ? <><input name="scheduleKind" type="hidden" value="weekly" /><WeekdayCheckboxes defaultSelected={rule.scheduleDaysOfWeek} /></>
        : null}
      {pattern === "monthly" ? <MonthlyRuleFields rule={rule} /> : null}
      {pattern === "yearly"
        ? <><input name="scheduleKind" type="hidden" value="yearly" /><YearlyFields rule={rule} /></>
        : null}
    </fieldset>
  );
}

function CompletionRuleFields({ rule }: { rule: CompletionRuleValues }) {
  const [unit, setUnit] = useState(rule.recommendedUnit);
  const maximum = { day: 3650, month: 120, week: 520, year: 10 }[unit];
  return (
    <fieldset className="todo-fieldset">
      <legend>次回の目安</legend>
      <label htmlFor="recurring-rule-min">最短</label>
      <input defaultValue={rule.recommendedStartValue} id="recurring-rule-min" max={maximum} min={0} name="intervalMin" required type="number" />
      <label htmlFor="recurring-rule-max">最長</label>
      <input defaultValue={rule.recommendedUntilValue} id="recurring-rule-max" max={maximum} min={0} name="intervalMax" required type="number" />
      <label htmlFor="recurring-rule-unit">単位</label>
      <select id="recurring-rule-unit" name="intervalUnit" onChange={(event) => { setUnit(event.currentTarget.value as typeof unit); }} value={unit}>
        <option value="day">日後</option><option value="week">週間後</option>
        <option value="month">か月後</option><option value="year">年後</option>
      </select>
    </fieldset>
  );
}

// Issue #99: 登録フォームと同じく「N」「日/週間」「ごと」を一続きに読めるよう並べ、
// 項目名(間隔・単位)は画面には出さず読み上げにだけ残す。
function IntervalRuleFields({ rule }: { rule: IntervalRuleValues }) {
  const [unit, setUnit] = useState(rule.intervalUnit);
  return (
    <fieldset className="todo-fieldset">
      <legend>繰り返す間隔</legend>
      <div className="fixed-interval-fields">
        <label className="sr-only" htmlFor="recurring-rule-interval-count">間隔</label>
        <input defaultValue={rule.intervalCount} id="recurring-rule-interval-count" inputMode="numeric" max={unit === "week" ? 520 : 3650} min={1} name="fixedIntervalCount" required step={1} type="number" />
        <label className="sr-only" htmlFor="recurring-rule-interval-unit">単位</label>
        <select id="recurring-rule-interval-unit" name="fixedIntervalUnit" onChange={(event) => { setUnit(event.currentTarget.value as typeof unit); }} value={unit}>
          <option value="day">日</option><option value="week">週間</option>
        </select>
        <span>ごと</span>
      </div>
      <label htmlFor="recurring-rule-anchor">起点日</label>
      <input defaultValue={rule.intervalAnchorOn} id="recurring-rule-anchor" name="fixedIntervalAnchorDate" required type="date" />
    </fieldset>
  );
}

function RuleFields({ rule }: { rule: RecurringRuleEditValues }) {
  if (rule.recurrenceBasis === "calendar") return <CalendarRuleFields rule={rule} />;
  if (rule.recurrenceBasis === "completion") return <CompletionRuleFields rule={rule} />;
  return <IntervalRuleFields rule={rule} />;
}

function formatInputDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${year}年${Number(month).toString()}月${Number(day).toString()}日`;
}

function RecurringOccurrenceForm({ id, members, occurrence }: {
  id: string; members: AssigneeOption[]; occurrence: RecurringOccurrenceValues;
}) {
  const [state, action] = useActionState(updateRecurringOccurrence, INITIAL_MAINTENANCE_TODO_STATE);
  return (
    <section aria-labelledby="recurring-occurrence-title" className="detail-card">
      <h2 id="recurring-occurrence-title">今回のTodo</h2>
      <p className="detail-note">本来の予定日は次回計算と履歴の基準として変えず、担当と現在の期限だけを変更します。</p>
      <form action={action} className="auth-form maintenance-todo-form">
        <input name="id" type="hidden" value={id} />
        <p>本来の予定日: {formatInputDate(occurrence.scheduledDate)}</p>
        <AssigneeField assigneeUserId={occurrence.assigneeUserId} members={members} />
        <label htmlFor="recurring-occurrence-due">現在の期限</label>
        <input defaultValue={occurrence.dueDate} id="recurring-occurrence-due" name="dueDate" required type="date" />
        <SubmitButton />
        <FormFeedback state={state} />
      </form>
    </section>
  );
}

function RecurringRuleForm({ id, managedItems, rule }: {
  id: string; managedItems: TodoManagedItemOption[]; rule: RecurringRuleEditValues;
}) {
  const [state, action] = useActionState(updateRecurringRule, INITIAL_MAINTENANCE_TODO_STATE);
  return (
    <section aria-labelledby="recurring-rule-title" className="detail-card">
      <h2 id="recurring-rule-title">今後の繰り返し</h2>
      <p className="detail-note">Todo名、関連する管理対象、繰り返し条件を変更します。現在回の予定と期限は変わりません。過去の完了記録は変わりません。</p>
      <form action={action} className="auth-form maintenance-todo-form">
        <input name="id" type="hidden" value={id} />
        <input name="recurrenceBasis" type="hidden" value={rule.recurrenceBasis} />
        <label htmlFor="recurring-rule-name">Todo名</label>
        <input defaultValue={rule.title} id="recurring-rule-name" maxLength={100} name="title" required type="text" />
        <RuleFields rule={rule} />
        <ManagedItemSearch idPrefix="recurring-rule" initialManagedItemId={rule.managedItemId} managedItems={managedItems} />
        <SubmitButton />
        <FormFeedback state={state} />
      </form>
    </section>
  );
}

export function RecurringTodoEditForms({ id, managedItems, members, occurrence, rule }: {
  id: string;
  managedItems: TodoManagedItemOption[];
  members: AssigneeOption[];
  occurrence: RecurringOccurrenceValues;
  rule: RecurringRuleEditValues;
}) {
  return (
    <>
      <RecurringOccurrenceForm id={id} members={members} occurrence={occurrence} />
      <RecurringRuleForm id={id} managedItems={managedItems} rule={rule} />
      <Link className="nickname-toggle-button" href={`/todos/${encodeURIComponent(id)}`}>キャンセル</Link>
    </>
  );
}

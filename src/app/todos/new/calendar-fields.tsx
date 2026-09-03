"use client";

import { useState } from "react";

import { WEEKDAY_OPTIONS, WeekdayCheckboxes } from "../weekday-checkboxes";
import { WeekPositionCheckboxes } from "../week-position-checkboxes";

// Issue #101: Todo登録フォームの定例日の入力欄。毎週・毎月の2方式・毎年の
// 2方式へ増え、他の繰り返し方(recurrence-fields.tsx)と同じファイルに収まら
// なくなったため分けた。表示・入力の責務だけを持ち、送信はフォーム側が行う。

type CalendarPattern = "monthly" | "weekly" | "yearly";
type MonthlyMode = "monthly_day" | "monthly_nth_weekday";
type YearlyMode = "yearly" | "yearly_nth_weekday";

function WeekdaySelect() {
  return (
    <>
      <label htmlFor="todo-schedule-weekday">曜日</label>
      <select defaultValue="1" id="todo-schedule-weekday" name="scheduleDayOfWeek">
        {WEEKDAY_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
    </>
  );
}

function DayOfMonthInput({ helpText }: { helpText: string }) {
  const [hasError, setHasError] = useState(false);
  const helpId = "todo-schedule-day-help";
  const errorId = "todo-schedule-day-error";

  return (
    <>
      <label htmlFor="todo-schedule-day">日付</label>
      <div className="calendar-day-input">
        <input
          aria-describedby={helpId}
          aria-errormessage={hasError ? errorId : undefined}
          aria-invalid={hasError || undefined}
          defaultValue={1}
          id="todo-schedule-day"
          inputMode="numeric"
          max={31}
          min={1}
          name="scheduleDayOfMonth"
          onBlur={(event) => { setHasError(!event.currentTarget.validity.valid); }}
          onChange={(event) => {
            if (hasError) setHasError(!event.currentTarget.validity.valid);
          }}
          onInvalid={() => { setHasError(true); }}
          required
          step={1}
          type="number"
        />
        <span aria-hidden="true">日</span>
      </div>
      <p className="input-help" id={helpId}>{helpText}</p>
      {hasError ? (
        <p className="field-error" id={errorId} role="alert">
          1〜31の整数で入力してください。
        </p>
      ) : null}
    </>
  );
}

// Issue #227 / YDR-032: 「毎月31日」と「毎月末」は意味が異なる別の指定として
// 扱う。月末を選ぶと日付の入力自体が不要になる。
function MonthlyDayFields() {
  const [monthEnd, setMonthEnd] = useState(false);
  return (
    <>
      <fieldset className="todo-fieldset">
        <legend>指定方法</legend>
        <label className="radio-option">
          <input
            checked={!monthEnd}
            name="scheduleDayMode"
            onChange={() => { setMonthEnd(false); }}
            type="radio"
            value="fixed_day"
          />
          日付を指定
        </label>
        <label className="radio-option">
          <input
            checked={monthEnd}
            name="scheduleDayMode"
            onChange={() => { setMonthEnd(true); }}
            type="radio"
            value="month_end"
          />
          毎月末
        </label>
      </fieldset>
      {monthEnd ? (
        <>
          <input name="scheduleMonthEnd" type="hidden" value="1" />
          <p className="input-help">
            その月の最終日(1月31日、2月28日/29日、4月30日など)を予定日にします。
          </p>
        </>
      ) : (
        <DayOfMonthInput helpText="1〜31の日付を入力してください。存在しない日は、その月の月末に合わせます。" />
      )}
    </>
  );
}

function MonthlyWeekdayFields() {
  return (
    <>
      <WeekPositionCheckboxes defaultSelected={[1]} />
      <WeekdaySelect />
      <p className="input-help">
        第5曜日がない月はその月をスキップし、最終は毎月の最後の曜日を選びます。
      </p>
    </>
  );
}

function MonthSelect() {
  return (
    <>
      <label htmlFor="todo-schedule-month">月</label>
      <select defaultValue="1" id="todo-schedule-month" name="scheduleMonth">
        {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
          <option key={month} value={month}>{month}月</option>
        ))}
      </select>
    </>
  );
}

// Issue #101 / YDR-040の3・4: 毎年も「日付で指定」と「曜日で指定」を切り替える。
// 曜日方式の入力欄は毎月と同じ共通部品を使い、年次側に独自の入力を作らない。
function YearlyWeekdayFields() {
  return (
    <>
      <WeekPositionCheckboxes defaultSelected={[1]} />
      <WeekdaySelect />
      <p className="input-help">
        第5曜日がない年はその年をスキップし、最終は指定した月の最後の曜日を選びます。
      </p>
    </>
  );
}

function YearlyFields() {
  const [mode, setMode] = useState<YearlyMode>("yearly");
  return (
    <>
      <fieldset className="todo-fieldset">
        <legend>毎年の指定方法</legend>
        <label className="radio-option">
          <input
            checked={mode === "yearly"}
            name="scheduleKind"
            onChange={() => { setMode("yearly"); }}
            type="radio"
            value="yearly"
          />
          日付で指定
        </label>
        <label className="radio-option">
          <input
            checked={mode === "yearly_nth_weekday"}
            name="scheduleKind"
            onChange={() => { setMode("yearly_nth_weekday"); }}
            type="radio"
            value="yearly_nth_weekday"
          />
          曜日で指定
        </label>
      </fieldset>
      <MonthSelect />
      {mode === "yearly"
        ? (
          <DayOfMonthInput helpText="1〜31の日付を入力してください。2月29日は、平年には2月28日に合わせます。" />
        )
        : <YearlyWeekdayFields />}
    </>
  );
}

function MonthlyFields() {
  const [mode, setMode] = useState<MonthlyMode>("monthly_day");
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
      {mode === "monthly_day" ? <MonthlyDayFields /> : <MonthlyWeekdayFields />}
    </>
  );
}

function CalendarPatternFields({ pattern }: { pattern: CalendarPattern }) {
  switch (pattern) {
    case "weekly":
      return (
        <>
          <input name="scheduleKind" type="hidden" value="weekly" />
          <WeekdayCheckboxes defaultSelected={[1]} />
        </>
      );
    case "monthly":
      return <MonthlyFields />;
    case "yearly":
      return <YearlyFields />;
  }
}

export function CalendarFields() {
  const [pattern, setPattern] = useState<CalendarPattern>("weekly");
  return (
    <fieldset className="todo-fieldset">
      <legend>定例日</legend>
      <label htmlFor="todo-schedule-kind">定例パターン</label>
      <select
        id="todo-schedule-kind"
        name="calendarPattern"
        onChange={(event) => { setPattern(event.currentTarget.value as CalendarPattern); }}
        value={pattern}
      >
        <option value="weekly">毎週</option>
        <option value="monthly">毎月</option>
        <option value="yearly">毎年</option>
      </select>
      <CalendarPatternFields pattern={pattern} />
      <p className="input-help">登録日を含め、最初に当てはまる日からTodoを作ります。</p>
    </fieldset>
  );
}

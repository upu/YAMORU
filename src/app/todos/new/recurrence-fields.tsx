"use client";

import { useState } from "react";

// Issue #99: Todo登録フォームの、繰り返し方ごとの入力欄。方式が4つになり
// 1ファイルに収まらなくなったため、フォーム本体(todo-registration-form.tsx)
// から入力欄だけを分けた。表示・入力の責務だけを持ち、送信はフォーム側が行う。

type ScheduleKind = "monthly_day" | "monthly_nth_weekday" | "weekly" | "yearly";

const WEEKDAYS = [
  [1, "月曜日"],
  [2, "火曜日"],
  [3, "水曜日"],
  [4, "木曜日"],
  [5, "金曜日"],
  [6, "土曜日"],
  [7, "日曜日"],
] as const;

function WeekdaySelect() {
  return (
    <>
      <label htmlFor="todo-schedule-weekday">曜日</label>
      <select defaultValue="1" id="todo-schedule-weekday" name="scheduleDayOfWeek">
        {WEEKDAYS.map(([value, label]) => (
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

function CalendarPatternFields({ scheduleKind }: { scheduleKind: ScheduleKind }) {
  switch (scheduleKind) {
    case "weekly":
      return <WeekdaySelect />;
    case "monthly_day":
      return <MonthlyDayFields />;
    case "monthly_nth_weekday":
      return (
        <>
          <label htmlFor="todo-schedule-week">第何週</label>
          <select defaultValue="1" id="todo-schedule-week" name="scheduleWeekOfMonth">
            {[1, 2, 3, 4, 5].map((week) => (
              <option key={week} value={week}>第{week}週</option>
            ))}
          </select>
          <WeekdaySelect />
          <p className="input-help">第5曜日がない月は、その月をスキップします。</p>
        </>
      );
    case "yearly":
      return (
        <>
          <label htmlFor="todo-schedule-month">月</label>
          <select defaultValue="1" id="todo-schedule-month" name="scheduleMonth">
            {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
              <option key={month} value={month}>{month}月</option>
            ))}
          </select>
          <DayOfMonthInput helpText="1〜31の日付を入力してください。2月29日は、平年には2月28日に合わせます。" />
        </>
      );
  }
}

export function CalendarFields() {
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind>("weekly");
  return (
    <fieldset className="todo-fieldset">
      <legend>定例日</legend>
      <label htmlFor="todo-schedule-kind">定例パターン</label>
      <select
        id="todo-schedule-kind"
        name="scheduleKind"
        onChange={(event) => { setScheduleKind(event.currentTarget.value as ScheduleKind); }}
        value={scheduleKind}
      >
        <option value="weekly">毎週</option>
        <option value="monthly_day">毎月の日付</option>
        <option value="monthly_nth_weekday">毎月の第N曜日</option>
        <option value="yearly">毎年の月日</option>
      </select>
      <CalendarPatternFields scheduleKind={scheduleKind} />
      <p className="input-help">登録日を含め、最初に当てはまる日からTodoを作ります。</p>
    </fieldset>
  );
}

export function OneTimeFields() {
  return (
    <div className="todo-fieldset">
      <label htmlFor="todo-planned-date">予定日</label>
      <input id="todo-planned-date" name="plannedDate" type="date" />
      <p className="input-help">
        日付がまだ決まっていない場合は、空欄で登録できます。完了しても次のTodoは作成されません。
      </p>
    </div>
  );
}

type CompletionUnit = "day" | "month" | "week" | "year";

const COMPLETION_UNITS: { label: string; value: CompletionUnit }[] = [
  { label: "日後", value: "day" },
  { label: "週間後", value: "week" },
  { label: "か月後", value: "month" },
  { label: "年後", value: "year" },
];

const COMPLETION_UNIT_LABELS: Record<CompletionUnit, string> = {
  day: "日後",
  month: "か月後",
  week: "週間後",
  year: "年後",
};

function CalendarAdjustmentHelp({ unit }: { unit: CompletionUnit }) {
  if (unit !== "month" && unit !== "year") return null;
  return (
    <p className="input-help">
      月末やうるう日など、移動先に存在しない日は、その月の月末に合わせます。
    </p>
  );
}

function completionIntervalDescription(
  minimum: string,
  maximum: string,
  unit: CompletionUnit,
): string {
  return `完了すると、その日から${minimum}〜${maximum}${COMPLETION_UNIT_LABELS[unit]}が次回の目安になります。`;
}

export function IntervalFields() {
  const [intervalMin, setIntervalMin] = useState("1");
  const [intervalMax, setIntervalMax] = useState("2");
  const [intervalUnit, setIntervalUnit] = useState<CompletionUnit>("week");
  const maximum = { day: 3650, month: 120, week: 520, year: 10 }[intervalUnit];

  return (
    <fieldset className="todo-fieldset">
      <legend>次回の目安</legend>
      <div className="interval-fields">
        <label htmlFor="todo-interval-min">最短</label>
        <input
          id="todo-interval-min"
          max={maximum}
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
          max={maximum}
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
            setIntervalUnit(event.currentTarget.value as CompletionUnit);
          }}
          value={intervalUnit}
        >
          {COMPLETION_UNITS.map((unit) => (
            <option key={unit.value} value={unit.value}>{unit.label}</option>
          ))}
        </select>
      </div>
      <p className="input-help">
        {completionIntervalDescription(intervalMin, intervalMax, intervalUnit)}
      </p>
      <CalendarAdjustmentHelp unit={intervalUnit} />
    </fieldset>
  );
}

// Issue #99 / YDR-037: 固定間隔の入力。「N」「日/週間」「ごと」を一続きに読めるよう
// 並べ、項目名(間隔・単位)は画面には出さず読み上げにだけ残す。回数は初期値を入れず、
// 例示のプレースホルダで数字を入れる欄だと分かるようにする。
export function FixedIntervalFields() {
  const [count, setCount] = useState("");
  const [unit, setUnit] = useState<"day" | "week">("day");
  const unitLabel = unit === "week" ? "週間" : "日";
  const alias = unit === "week" && count === "2" ? "(隔週)" : "";

  return (
    <fieldset className="todo-fieldset">
      <legend>繰り返す間隔</legend>
      <div className="fixed-interval-fields">
        <label className="sr-only" htmlFor="todo-fixed-interval-count">間隔</label>
        <input
          id="todo-fixed-interval-count"
          inputMode="numeric"
          max={unit === "week" ? 520 : 3650}
          min={1}
          name="fixedIntervalCount"
          onChange={(event) => { setCount(event.currentTarget.value); }}
          placeholder="5"
          required
          step={1}
          type="number"
          value={count}
        />
        <label className="sr-only" htmlFor="todo-fixed-interval-unit">単位</label>
        <select
          id="todo-fixed-interval-unit"
          name="fixedIntervalUnit"
          onChange={(event) => {
            setUnit(event.currentTarget.value as "day" | "week");
          }}
          value={unit}
        >
          <option value="day">日</option>
          <option value="week">週間</option>
        </select>
        <span>ごと</span>
      </div>
      <label htmlFor="todo-fixed-interval-anchor">起点日</label>
      <input
        id="todo-fixed-interval-anchor"
        name="fixedIntervalAnchorDate"
        required
        type="date"
      />
      <p className="input-help">
        {count === ""
          ? `起点日から何${unitLabel}ごとに予定するかを入力します。`
          : `起点日から${count}${unitLabel}ごと${alias}に予定します。`}
        起点日が過去の場合は、今日以降で最初に当てはまる日からTodoを作ります。
      </p>
    </fieldset>
  );
}

export function InitialDateFields() {
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

"use client";

import { useState } from "react";

export const MONTHLY_WEEKS_FIELD_NAME = "scheduleWeekOfMonth";
export const MONTHLY_WEEK_LAST_FIELD_NAME = "scheduleWeekLast";
export const EMPTY_MONTHLY_WEEK_POSITIONS_MESSAGE =
  "第1〜第5または最終を1つ以上選んでください。";

const WEEK_OPTIONS = [1, 2, 3, 4, 5] as const;

// Issue #100 / YDR-040: 第5と最終は同じ月に同日になることがあっても別の意味を
// 持つため、独立したチェックボックスとして常に選択状態を見せる。
export function MonthlyWeekPositionCheckboxes({
  defaultLast = false,
  defaultSelected,
}: {
  defaultLast?: boolean;
  defaultSelected: readonly number[];
}) {
  const hasDefault = defaultSelected.length > 0 || defaultLast;
  const [selected, setSelected] = useState<number[]>(
    hasDefault ? [...defaultSelected] : [1],
  );
  const [last, setLast] = useState(defaultLast);
  const isEmpty = selected.length === 0 && !last;
  const errorId = "todo-schedule-monthly-weeks-error";

  return (
    <fieldset
      aria-errormessage={isEmpty ? errorId : undefined}
      aria-invalid={isEmpty || undefined}
      className="todo-fieldset"
    >
      <legend>月の何回目</legend>
      <div className="weekday-options">
        {WEEK_OPTIONS.map((week) => (
          <label className="radio-option" key={week}>
            <input
              checked={selected.includes(week)}
              name={MONTHLY_WEEKS_FIELD_NAME}
              onChange={(event) => {
                const { checked } = event.currentTarget;
                setSelected((current) => checked
                  ? [...current, week].sort((left, right) => left - right)
                  : current.filter((value) => value !== week));
              }}
              required={isEmpty}
              type="checkbox"
              value={week}
            />
            第{week}
          </label>
        ))}
        <label className="radio-option">
          <input
            checked={last}
            name={MONTHLY_WEEK_LAST_FIELD_NAME}
            onChange={(event) => { setLast(event.currentTarget.checked); }}
            required={isEmpty}
            type="checkbox"
            value="1"
          />
          最終
        </label>
      </div>
      {isEmpty ? (
        <p className="field-error" id={errorId} role="alert">
          {EMPTY_MONTHLY_WEEK_POSITIONS_MESSAGE}
        </p>
      ) : null}
    </fieldset>
  );
}

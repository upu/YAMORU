"use client";

import { useState } from "react";

// Issue #102 / YDR-040: 「毎週」は複数の曜日を候補指定として持てる。登録
// フォームと編集フォームが同じ入力を使うため、ここに一つだけ置く。
// 一般的な複数選択selectを使わず、選択済みの曜日が常に見えるチェックボックスに
// する(#102の設計メモ)。

export const WEEKDAY_OPTIONS = [
  [1, "月曜日"],
  [2, "火曜日"],
  [3, "水曜日"],
  [4, "木曜日"],
  [5, "金曜日"],
  [6, "土曜日"],
  [7, "日曜日"],
] as const;

export const WEEKDAYS_FIELD_NAME = "scheduleDaysOfWeek";

export const EMPTY_WEEKDAYS_MESSAGE = "曜日を1つ以上選んでください。";

export function WeekdayCheckboxes(
  { defaultSelected }: { defaultSelected: readonly number[] },
) {
  const [selected, setSelected] = useState<number[]>(
    defaultSelected.length === 0 ? [1] : [...defaultSelected],
  );
  const errorId = "todo-schedule-weekdays-error";
  const isEmpty = selected.length === 0;

  return (
    <fieldset
      aria-errormessage={isEmpty ? errorId : undefined}
      aria-invalid={isEmpty || undefined}
      className="todo-fieldset"
    >
      <legend>曜日</legend>
      <div className="weekday-options">
        {WEEKDAY_OPTIONS.map(([value, label]) => (
          <label className="radio-option" key={value}>
            <input
              checked={selected.includes(value)}
              name={WEEKDAYS_FIELD_NAME}
              onChange={(event) => {
                // Reactのイベントは更新関数が動く時点で使い回されているため、
                // checkedはここで取り出してから状態を更新する。
                const { checked } = event.currentTarget;
                setSelected((current) =>
                  checked
                    ? [...current, value].sort((left, right) => left - right)
                    : current.filter((weekday) => weekday !== value)
                );
              }}
              // 未選択のときだけすべてを必須にして、ブラウザにも送信を止めさせる。
              // 1つでも選ばれたら必須を外し、他の曜日を任意のままにする。
              required={isEmpty}
              type="checkbox"
              value={value}
            />
            {label}
          </label>
        ))}
      </div>
      {isEmpty ? (
        <p className="field-error" id={errorId} role="alert">
          {EMPTY_WEEKDAYS_MESSAGE}
        </p>
      ) : null}
    </fieldset>
  );
}

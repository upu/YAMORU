// Issue #42: 開始時期は「分かる精度だけ」を残す。年しか覚えていない対象へ
// 偽の月日を推測入力させないため、年 / 年月 / 年月日の三段階を扱う。
//
// 保存形式はISO-8601の日付を分かる精度で切り詰めた一つの文字列とし
// (`2024` / `2024-05` / `2024-05-10`)、精度を別の列へ持たない。精度は
// 長さから一意に決まるため「精度はyearなのに日が入っている」といった
// 不整合が起こらず、辞書順の比較が暦順と一致する。
//
// Issue #239: 保存項目そのものの名前は`purchasedOn`(購入時期)から中立的な
// `startedOn`(対象との関係が始まった時期)へ移行した(YDR-033)。この
// モジュールが扱うのは値の精度・書式であり、大分類ごとの画面ラベルは
// model.tsのstartedOnLabelが受け持つ。
export type StartedOnPrecision = "day" | "month" | "year";

export type StartedOnParts = {
  day: string;
  month: string;
  year: string;
};

export const EMPTY_STARTED_ON_PARTS: StartedOnParts = {
  day: "",
  month: "",
  year: "",
};

const YEAR_PATTERN = /^\d{4}$/u;

export function startedOnPrecision(value: string): StartedOnPrecision {
  const parts = value.split("-");
  if (parts.length === 1) return "year";
  return parts.length === 2 ? "month" : "day";
}

export function formatStartedOn(value: string): string {
  const [year, month, day] = value.split("-");
  switch (startedOnPrecision(value)) {
    case "year": return `${year}年ごろ`;
    case "month": return `${year}年${String(Number(month))}月`;
    default: return `${year}年${String(Number(month))}月${String(Number(day))}日`;
  }
}

// 編集画面の初期値へ戻す。保存されていない精度の欄は空にする。
export function splitStartedOn(value: string | null): StartedOnParts {
  if (value === null) return EMPTY_STARTED_ON_PARTS;
  const [year = "", month = "", day = ""] = value.split("-");
  return { day, month, year };
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export type StartedOnResult =
  | { status: "error" }
  | { status: "ok"; value: string | null };

function toMonthOrDay(
  year: string,
  month: string,
  day: string,
): StartedOnResult {
  const monthNumber = Number(month);
  if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    return { status: "error" };
  }
  const paddedMonth = String(monthNumber).padStart(2, "0");
  if (day.length === 0) return { status: "ok", value: `${year}-${paddedMonth}` };

  const dayNumber = Number(day);
  if (!isRealCalendarDate(Number(year), monthNumber, dayNumber)) {
    return { status: "error" };
  }
  return {
    status: "ok",
    value: `${year}-${paddedMonth}-${String(dayNumber).padStart(2, "0")}`,
  };
}

// 年 / 年月 / 年月日のいずれか、またはすべて空だけを受け付ける。
// 年のない月、月のない日は「分かる精度」として成立しないため拒否する。
export function toStartedOn(parts: StartedOnParts): StartedOnResult {
  const year = parts.year.trim();
  const month = parts.month.trim();
  const day = parts.day.trim();

  if (year.length === 0) {
    return month.length === 0 && day.length === 0
      ? { status: "ok", value: null }
      : { status: "error" };
  }
  if (!YEAR_PATTERN.test(year)) return { status: "error" };
  if (month.length === 0) {
    return day.length === 0 ? { status: "ok", value: year } : { status: "error" };
  }
  return toMonthOrDay(year, month, day);
}

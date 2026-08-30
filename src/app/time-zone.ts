import {
  maintenanceReminderThresholdDays,
  type MaintenanceDisplayState,
  type StrictDisplayState,
} from "./task-schedule";

export const PHASE_ONE_TIME_ZONE = "Asia/Tokyo";

function parseDateParts(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return [year, month, day];
}

export function tokyoDateToUtcIso(value: string): string | null {
  if (parseDateParts(value) === null) return null;
  return new Date(`${value}T00:00:00+09:00`).toISOString();
}

export function addDaysToTokyoDateUtcIso(
  value: string,
  days: number,
): string | null {
  const parts = parseDateParts(value);
  if (parts === null) return null;
  const [year, month, day] = parts;
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const shiftedDate = [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
  return tokyoDateToUtcIso(shiftedDate);
}

export function formatTokyoDate(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    day: "numeric",
    month: "long",
    timeZone: PHASE_ONE_TIME_ZONE,
    year: "numeric",
  }).format(new Date(value));
}

// Issue #203: 保存済みの予定日を、date入力の初期値(YYYY-MM-DD)へ戻す。
// Server ComponentはUTCで動くことがあるため、ローカル時刻ではなくAsia/Tokyoの
// 暦日で戻し、画面表示(formatTokyoDate)と同じ日付を初期値にする。
export function formatTokyoDateInput(iso: string): string {
  return toTokyoDateString(iso);
}

function toTokyoDateString(iso: string): string {
  // en-CAはYYYY-MM-DD形式を返すため、そのまま文字列比較で日付の前後を判定できる。
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: PHASE_ONE_TIME_ZONE,
    year: "numeric",
  }).format(new Date(iso));
}

export function getStrictDisplayStateFromIso(
  dueAt: string,
  nowIso: string,
): StrictDisplayState {
  const today = toTokyoDateString(nowIso);
  const due = toTokyoDateString(dueAt);

  if (today > due) return "overdue";
  if (today === due) return "due-today";
  return "upcoming";
}

export function getTokyoDayDistance(fromIso: string, toIso: string): number {
  const from = Date.parse(`${toTokyoDateString(fromIso)}T00:00:00Z`);
  const to = Date.parse(`${toTokyoDateString(toIso)}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

export function describeStrictScheduleFromIso(
  state: StrictDisplayState,
  dueAt: string,
): string {
  const date = formatTokyoMonthDay(dueAt);
  switch (state) {
    case "overdue":
      return `${date}が予定日でした`;
    case "due-today":
      return `今日（${date}）の予定です`;
    case "upcoming":
      return `${date}の予定です`;
  }
}

// YDR-034 / Issue #281の4状態と80%しきい値を、実行環境のタイムゾーンに
// 依存せずAsia/Tokyoの暦日で判定する。Server ComponentはUTCで実行されることが
// あるため、ISO文字列同士をTokyoの暦日文字列・暦日数へそろえてから比較する。
export function getMaintenanceDisplayStateFromIso(
  window: { dueAt: string; scheduledFor: string },
  nowIso: string,
): MaintenanceDisplayState {
  const today = toTokyoDateString(nowIso);
  const scheduled = toTokyoDateString(window.scheduledFor);
  const due = toTokyoDateString(window.dueAt);
  const totalDays = getTokyoDayDistance(window.scheduledFor, window.dueAt);
  const elapsedDays = getTokyoDayDistance(window.scheduledFor, nowIso);

  if (today < scheduled) return "before-window";
  if (today > due) return "past-window";
  return elapsedDays < maintenanceReminderThresholdDays(totalDays)
    ? "in-window"
    : "reminder-window";
}

export function formatTokyoMonthDay(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    day: "numeric",
    month: "long",
    timeZone: PHASE_ONE_TIME_ZONE,
  }).format(new Date(value));
}

// Issue #243: コンパクトなリスト表示専用。「8月28日」ではなく「8/28」の
// ように、意味を保ったまま短く表す(issue本文の期待する挙動)。
export function formatTokyoShortMonthDay(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    day: "numeric",
    month: "numeric",
    timeZone: PHASE_ONE_TIME_ZONE,
  }).format(new Date(value));
}

// task-schedule.tsのdescribeMaintenanceScheduleと同じ文言方針(YDR-017)を、
// Tokyo基準のISO文字列から組み立てる。「交換」など特定の操作を前提にした
// 表現は使わず、Todoのタイトル側で対象操作を伝える前提の中立的な文言にする
// (ホームでは掃除・交換など様々なTaskRuleを同じ文言で表示するため)。
export function describeMaintenanceWindowFromIso(
  state: MaintenanceDisplayState,
  window: { dueAt: string; scheduledFor: string },
): string {
  switch (state) {
    case "before-window":
      return `${formatTokyoMonthDay(window.scheduledFor)}から推奨期間です`;
    case "in-window":
    case "reminder-window":
      return `${formatTokyoMonthDay(window.dueAt)}までが推奨期間です`;
    case "past-window":
      return `${formatTokyoMonthDay(window.dueAt)}に推奨期間の上限を過ぎました`;
  }
}

// 完了記録ダイアログの「実施日」入力欄の既定値。ブラウザで実行される
// クライアント側の表示専用であり、利用者のローカル時刻をそのまま使う
// (サーバー側の期限分類が使うAsia/Tokyo基準の関数とは目的が異なる)。
export function formatDateInput(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

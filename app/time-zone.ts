import type { MaintenanceDisplayState } from "./task-schedule";

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

function toTokyoDateString(iso: string): string {
  // en-CAはYYYY-MM-DD形式を返すため、そのまま文字列比較で日付の前後を判定できる。
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: PHASE_ONE_TIME_ZONE,
    year: "numeric",
  }).format(new Date(iso));
}

// task-schedule.tsのgetMaintenanceDisplayStateと同じ3状態判定(YDR-017)を、
// 実行環境のタイムゾーンに依存せずAsia/Tokyoの暦日で行う。Server Componentは
// UTCで実行されることがあり、ローカルDateのstartOfDayでは日付境界がずれて
// ホーム/詳細間で判定が食い違いうるため、ISO文字列同士をTokyoの暦日文字列へ
// そろえてから比較する。
export function getMaintenanceDisplayStateFromIso(
  window: { dueAt: string; scheduledFor: string },
  nowIso: string,
): MaintenanceDisplayState {
  const today = toTokyoDateString(nowIso);
  const scheduled = toTokyoDateString(window.scheduledFor);
  const due = toTokyoDateString(window.dueAt);

  if (today < scheduled) return "before-window";
  if (today <= due) return "in-window";
  return "past-window";
}

export function formatTokyoMonthDay(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    day: "numeric",
    month: "long",
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

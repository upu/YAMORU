// YDR-017: 厳密な期限とメンテナンスの推奨期間を区別する
//
// scheduled_for/due_atの意味はYDR-012に従う。maintenanceでは
// scheduled_forを推奨期間の開始、due_atを推奨期間の上限として使う。
// strictではscheduled_forとdue_atを同日として扱い、期限切れ表示を維持する。

export const MAINTENANCE_RECOMMENDED_START_DAYS = 28; // 4週間
export const MAINTENANCE_RECOMMENDED_UPPER_DAYS = 56; // 8週間

export type TodoTone =
  | "urgent"
  | "today"
  | "upcoming"
  | "done"
  | "reminder"
  | "caution";

export type MaintenanceWindow = { scheduledFor: Date; dueAt: Date };

export type MaintenanceDisplayState =
  | "before-window"
  | "in-window"
  | "past-window";

export type StrictDisplayState = "upcoming" | "due-today" | "overdue";

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);

  // 日付境界のずれを避けるため、正午を基準にします。
  return new Date(year, month - 1, day, 12);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function formatMonthDay(date: Date): string {
  return `${String(date.getMonth() + 1)}月${String(date.getDate())}日`;
}

export function computeMaintenanceWindow(occurredAt: Date): MaintenanceWindow {
  return {
    scheduledFor: addDays(occurredAt, MAINTENANCE_RECOMMENDED_START_DAYS),
    dueAt: addDays(occurredAt, MAINTENANCE_RECOMMENDED_UPPER_DAYS),
  };
}

export function getMaintenanceDisplayState(
  window: MaintenanceWindow,
  now: Date,
): MaintenanceDisplayState {
  const today = startOfDay(now);
  const scheduled = startOfDay(window.scheduledFor);
  const due = startOfDay(window.dueAt);

  if (today < scheduled) return "before-window";
  if (today <= due) return "in-window";
  return "past-window";
}

export function getStrictDisplayState(
  dueAt: Date,
  now: Date,
): StrictDisplayState {
  const today = startOfDay(now);
  const due = startOfDay(dueAt);

  if (today > due) return "overdue";
  if (today === due) return "due-today";
  return "upcoming";
}

export const MAINTENANCE_DISPLAY_COPY: Record<
  MaintenanceDisplayState,
  { badge: string; tone: TodoTone; message: string }
> = {
  "before-window": {
    badge: "予定",
    tone: "upcoming",
    message: "次回の交換予定です",
  },
  "in-window": {
    badge: "そろそろ",
    tone: "reminder",
    message: "そろそろ交換時期です",
  },
  "past-window": {
    badge: "要確認",
    tone: "caution",
    message: "交換推奨期間を過ぎています",
  },
};

export const STRICT_DISPLAY_COPY: Record<
  StrictDisplayState,
  { badge: string; tone: TodoTone }
> = {
  upcoming: { badge: "予定", tone: "upcoming" },
  "due-today": { badge: "今日", tone: "today" },
  overdue: { badge: "期限切れ", tone: "urgent" },
};

export function describeMaintenanceSchedule(
  state: MaintenanceDisplayState,
  window: MaintenanceWindow,
): string {
  switch (state) {
    case "before-window":
      return `${formatMonthDay(window.scheduledFor)}から交換の目安です`;
    case "in-window":
      return `${formatMonthDay(window.dueAt)}までが交換の目安です`;
    case "past-window":
      return `${formatMonthDay(window.dueAt)}に交換推奨期間の上限を過ぎました`;
  }
}

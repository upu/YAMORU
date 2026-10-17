import { formatTokyoDateInput, getMaintenanceDisplayStateFromIso } from "../../todos/projection/time-zone";

export type AttentionSource = {
  kind: "todo_occurrence" | "consumable"; id: string; name: string; status: string;
  assignee_user_id: string | null; deadline_kind: string | null;
  scheduled_for: string | null; due_at: string | null; must_complete_by: string | null;
  stock_status: string | null;
};
export const REASONS = ["hard_deadline_overdue", "hard_deadline_today", "scheduled_due", "stock_out", "maintenance_overdue", "maintenance_window", "maintenance_soon", "stock_low"] as const;
export type AttentionReason = typeof REASONS[number];
const maintenanceReasons = { "past-window": "maintenance_overdue", "in-window": "maintenance_window", "reminder-window": "maintenance_soon" } as const;
const day = (value: string | null) => value === null ? null : formatTokyoDateInput(value);

function todoDates(source: AttentionSource, now: Date) {
  const maintenance = source.deadline_kind === "maintenance";
  const window = maintenance && source.scheduled_for && source.due_at ? {
    start: day(source.scheduled_for), end: day(source.due_at),
    state: getMaintenanceDisplayStateFromIso({ scheduledFor: source.scheduled_for, dueAt: source.due_at }, now.toISOString()),
  } : null;
  return { time_zone: "Asia/Tokyo" as const, scheduled_on: maintenance ? null : day(source.scheduled_for),
    due_on: maintenance ? null : day(source.due_at), must_complete_by: source.must_complete_by, recommended_window: window };
}

function todoReasons(dates: ReturnType<typeof todoDates>, today: string): AttentionReason[] {
  const reasons: AttentionReason[] = [];
  if (dates.must_complete_by && dates.must_complete_by <= today) {
    reasons.push(dates.must_complete_by < today ? "hard_deadline_overdue" : "hard_deadline_today");
  }
  if (dates.due_on && dates.due_on <= today) reasons.push("scheduled_due");
  if (dates.recommended_window && dates.recommended_window.state !== "before-window") reasons.push(maintenanceReasons[dates.recommended_window.state]);
  return reasons;
}

export function projectAttention(source: AttentionSource, now: Date) {
  if (source.kind === "todo_occurrence" && source.status !== "pending") return null;
  const dates = source.kind === "todo_occurrence" ? todoDates(source, now) : null;
  const reasons: AttentionReason[] = dates ? todoReasons(dates, formatTokyoDateInput(now.toISOString())) : [];
  if (source.kind === "consumable" && source.stock_status === "out") reasons.push("stock_out");
  if (source.kind === "consumable" && source.stock_status === "low") reasons.push("stock_low");
  if (!reasons.length) return null;
  reasons.sort((a, b) => REASONS.indexOf(a) - REASONS.indexOf(b));
  return candidateFields(source, dates, reasons);
}

function candidateFields(source: AttentionSource, dates: ReturnType<typeof todoDates> | null, reasons: AttentionReason[]) {
  const rank = REASONS.indexOf(reasons[0]);
  const relevantDate = rank <= 1 ? dates?.must_complete_by : dates?.due_on ?? dates?.recommended_window?.end;
  return { kind: source.kind, entity_id: source.id, occurrence_id: source.kind === "todo_occurrence" ? source.id : null,
    name: source.name, assignee_user_id: source.kind === "todo_occurrence" ? source.assignee_user_id : null,
    stock_status: source.kind === "consumable" ? source.stock_status : null, reason_codes: reasons,
    priority: rank <= 3 ? "high" as const : "normal" as const, priority_rank: rank,
    sort_key: `${String(rank)}:${relevantDate ?? "9999-12-31"}:${source.kind}:${source.id}`, dates,
    detail_url: `/${source.kind === "todo_occurrence" ? "todos" : "consumables"}/${encodeURIComponent(source.id)}`,
    data_origin: "user_authored" as const };
}
export type AttentionPayload = NonNullable<ReturnType<typeof projectAttention>>;

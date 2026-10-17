import type { EntityRow, ReadVersion } from "../../lib/d1/conversation-read";
import { buildPendingTodoEntries } from "../todos/projection/pending-todo";
import { formatTokyoDateInput } from "../todos/projection/time-zone";
import { toWireValue } from "./read-contract";

type EntityData = {
  note?: string | null; status?: string; stock_status?: string;
  current_occurrence_id?: string | null; task_rule_id?: string;
  managed_item_id?: string | null; assignee_user_id?: string | null;
  scheduled_for?: string | null; due_at?: string | null; must_complete_by?: string | null;
  deadline_kind?: string; recurrence_basis?: string;
  [key: string]: unknown;
};

function detailUrl(row: EntityRow, data: EntityData): string | null {
  if (row.kind === "todo_occurrence" && data.status === "skipped") return null;
  if (row.kind === "todo_rule") return data.current_occurrence_id ? `/todos/${encodeURIComponent(data.current_occurrence_id)}` : "/todos";
  const prefix = { managed_item: "managed-items", todo_occurrence: "todos", consumable: "consumables" }[row.kind];
  return `/${prefix}/${encodeURIComponent(row.id)}`;
}

export function entitySummary(row: EntityRow, version: ReadVersion) {
  const data = JSON.parse(row.data) as EntityData;
  return {
    kind: row.kind, id: row.id, name: row.name, created_at: row.created_at,
    revision: JSON.stringify([1, row.kind, row.id, version.epoch, version.version]),
    // Conservative household revision timestamp; not an invented entity edit timestamp.
    updated_at: version.changed_at, updated_at_scope: "household_revision" as const,
    detail_url: detailUrl(row, data),
  };
}

function occurrenceState(row: EntityRow, data: EntityData, now: Date) {
  if (data.status !== "pending") return { status: data.status, category: data.status, badge: data.status === "completed" ? "完了" : "スキップ", tone: "done" };
  const [entry] = buildPendingTodoEntries([{
    id: row.id, assignee_user_id: data.assignee_user_id ?? null,
    due_at: data.due_at ?? null, scheduled_for: data.scheduled_for ?? null,
    must_complete_by: data.must_complete_by ?? null,
    task_rules: { title: row.name, deadline_kind: data.deadline_kind ?? "strict", recurrence_basis: data.recurrence_basis ?? "once",
      managed_items: data.managed_item_id ? { id: data.managed_item_id, name: row.related_name ?? "" } : null },
  }], now.toISOString());
  return { status: "pending", category: entry.category, badge: entry.item.badge, tone: entry.item.tone,
    schedule_state: entry.item.scheduleState ?? null, hard_deadline_today: entry.item.hardDeadlineToday ?? false,
    hard_deadline_overdue: entry.hardDeadlineOverdue ?? false };
}

function occurrenceDates(data: EntityData) {
  const day = (value: string | null | undefined) => value ? formatTokyoDateInput(value) : null;
  const maintenance = data.deadline_kind === "maintenance";
  return {
    time_zone: "Asia/Tokyo", scheduled_on: maintenance ? null : day(data.scheduled_for),
    due_on: maintenance ? null : day(data.due_at), must_complete_by: data.must_complete_by ?? null,
    recommended_window: maintenance ? { from: day(data.scheduled_for), until: day(data.due_at) } : null,
    semantics: { scheduled_on: "本来の予定日", due_on: "延期を反映した現在期限", must_complete_by: "今回だけの独立した必達日（次回へコピーしない）", recommended_window: "完了日基準の推奨期間（厳密な期限ではない）" },
  };
}

export function entityProjection(row: EntityRow, version: ReadVersion, now: Date) {
  const data = JSON.parse(row.data) as EntityData;
  return {
    ...entitySummary(row, version),
    data_origin: "user_authored" as const,
    attributes: toWireValue(data) as Record<string, unknown>,
    state: row.kind === "todo_occurrence" ? occurrenceState(row, data, now) : { stock_status: data.stock_status ?? null },
    dates: row.kind === "todo_occurrence" ? occurrenceDates(data) : null,
    // Mutations are introduced by #437/#438. Read scope alone grants none.
    allowed_operations: ["entity_get", "history_list"],
  };
}

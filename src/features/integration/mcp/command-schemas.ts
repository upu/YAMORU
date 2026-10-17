import { z } from "zod";
import type { CommandName } from "../commands/contract";
const text = z.string();
const nullableText = text.nullable().optional();
const recurrence = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("manual") }),
  z.strictObject({ type: z.literal("one_time"), scheduled_on: nullableText }),
  z.strictObject({ type: z.literal("completion"), unit: text.optional(), min: z.number().optional(), max: z.number().optional(), last_completed_on: text.optional(), first_scheduled_on: text.optional() }),
  z.strictObject({ type: z.literal("calendar"), kind: text.optional(), days_of_week: z.array(z.number()).optional(), day_of_month: z.number().nullable().optional(), month: z.number().nullable().optional(), day_of_week: z.number().nullable().optional(), month_end: z.boolean().optional(), weeks_of_month: z.array(z.number()).optional(), week_last: z.boolean().optional() }),
  z.strictObject({ type: z.literal("interval"), unit: text.optional(), count: z.number().optional(), start_on: text.optional() }),
]);
const todo = z.strictObject({ title: text.optional(), recurrence: recurrence.optional(), note: nullableText, managed_item_id: nullableText, assignee_id: nullableText, must_complete_by: nullableText });
const item = z.strictObject({ name: text.optional(), kind: text.optional().describe("asset / service"), item_type: nullableText, custom_item_type: nullableText, product_info: nullableText, note: nullableText, external_url: nullableText, started_on: nullableText, tag_ids: z.array(text).optional() });
const current = z.strictObject({ stock_status: text.optional().describe("available / low / out"), performer_id: nullableText }).optional();
const application = text.optional().describe("auto / history_only");
const observed = { observed_on: text.optional(), observed_at: text.optional().describe("offset付きISO 8601 または now"), stock_status: text.optional().describe("available / low / out"), performer_id: nullableText };
const refilled = { refilled_on: text.optional(), refilled_at: text.optional().describe("offset付きISO 8601 または now"), performer_id: nullableText };
const payloads = {
  "todo.create": todo,
  "managed_item.create": item,
  "managed_item_with_todo.create": z.strictObject({ managed_item: item.optional(), todo: todo.omit({ managed_item_id: true }).optional() }),
  "todo.complete": z.strictObject({ occurred_on: text.optional(), occurred_at: text.optional(), performer_id: nullableText }),
  "todo.undo": z.strictObject({ completion_log_id: text.optional() }),
  "todo.correct": z.strictObject({ completion_log_id: text.optional(), changes: z.strictObject({ occurred_on: text.optional(), occurred_at: text.optional(), performer_id: text.optional() }).optional() }),
  "stock.observe": z.strictObject({ ...observed, application, current_observation: current }),
  "stock.refill": z.strictObject({ ...refilled, application, current_observation: current }),
  "stock.correct": z.strictObject({ record_id: text.optional(), record_revision: z.number().optional(), void: z.boolean().optional(), changes: z.strictObject({ ...observed, ...refilled }).optional(), application, current_observation: current }),
  "notification.configure": z.strictObject({ settings_revision: z.number().optional(), enabled: z.boolean().optional(), connection_id: nullableText, time_zone: text.optional(), mode: text.optional(), digest_time: text.optional(), muted: z.boolean().optional(),
    quiet_hours: z.strictObject({ enabled: z.boolean().optional(), start: text.optional(), end: text.optional() }).optional(), repeat_policy: z.strictObject({ high_hours: z.number().optional(), normal_hours: z.number().optional() }).optional() }),
  "notification.snooze": z.strictObject({ candidate_id: text.optional(), candidate_revision: text.optional(), until: nullableText, muted: z.boolean().optional() }),
} satisfies Record<CommandName, z.ZodObject>;
const envelope = { operation_id: text, target: z.strictObject({ kind: text, id: text }).nullable().optional(), expected_revision: text.optional() };
// 必須の業務値を欠く入力も共通層へ渡し、missing_requiredとして質問項目を返す。
export const commandPrepareSchema = z.discriminatedUnion("command", [
  z.strictObject({ ...envelope, command: z.literal("todo.create"), payload: payloads["todo.create"].optional() }),
  z.strictObject({ ...envelope, command: z.literal("todo.complete"), payload: payloads["todo.complete"].optional() }),
  z.strictObject({ ...envelope, command: z.literal("todo.correct"), payload: payloads["todo.correct"].optional() }),
  z.strictObject({ ...envelope, command: z.literal("todo.undo"), payload: payloads["todo.undo"].optional() }),
  z.strictObject({ ...envelope, command: z.literal("managed_item.create"), payload: payloads["managed_item.create"].optional() }),
  z.strictObject({ ...envelope, command: z.literal("managed_item_with_todo.create"), payload: payloads["managed_item_with_todo.create"].optional() }),
  z.strictObject({ ...envelope, command: z.literal("stock.observe"), payload: payloads["stock.observe"].optional() }),
  z.strictObject({ ...envelope, command: z.literal("stock.refill"), payload: payloads["stock.refill"].optional() }),
  z.strictObject({ ...envelope, command: z.literal("stock.correct"), payload: payloads["stock.correct"].optional() }),
  z.strictObject({ ...envelope, command: z.literal("notification.configure"), payload: payloads["notification.configure"].optional() }),
  z.strictObject({ ...envelope, command: z.literal("notification.snooze"), payload: payloads["notification.snooze"].optional() }),
]);

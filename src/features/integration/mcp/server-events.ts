import { z } from "zod";
import type { McpContext } from "./server";
import { ModernMcpError } from "./modern-request";
import { authenticateBearerRequest } from "../oauth/bearer";
import { EventSubscriptionError } from "../notifications/event-errors";
import { WebhookEndpointError } from "../notifications/webhook-transport";
import { createEventSubscriptionService } from "../notifications/event-subscriptions";
import { eventFilterSchema } from "../notifications/event-filter";
const sourceSchema = z.strictObject({ kind: z.enum(["todo_occurrence", "consumable"]), entity_id: z.string(), todo_rule_id: z.string().nullable() });
export const attentionEventPayloadSchema = z.union([
  z.strictObject({ delivery_id: z.string(), candidate_ids: z.array(z.string()).min(1).max(1), observed_at: z.iso.datetime(), notification_mode: z.enum(["daily", "individual"]).optional(), source: sourceSchema }),
  z.strictObject({ group_id: z.string(), candidate_ids: z.array(z.string()).min(1).max(50), observed_at: z.iso.datetime(), notification_mode: z.literal("daily"),
    items: z.array(z.strictObject({ delivery_id: z.string(), candidate_id: z.string(), source: sourceSchema })).min(1).max(50) }),
]);
function eventDefinition() {
  return { name: "attention.ready", title: "家の用事のお知らせ", delivery: ["webhook"],
    description: "本人の通知設定に従って案内できる候補です。通知は遅れたり重複・順序逆転したりする場合があります。案内や操作の前にattention_getとentity_getで最新状態を確認してください。source（まとめではitemsの各source）は通知時の対象を示し、繰り返しTodoの次回へ読み替えないでください。cursorは非対応です。",
    inputSchema: z.toJSONSchema(eventFilterSchema, { io: "input" }), payloadSchema: z.toJSONSchema(attentionEventPayloadSchema),
    _meta: { securitySchemes: [{ type: "oauth2", scopes: ["household.read", "events.subscribe"] }] } };
}
function mappedError(error: unknown): never {
  if (error instanceof WebhookEndpointError) throw new ModernMcpError(400, -32602, "Invalid callback URL", { reason: error.reason });
  if (!(error instanceof EventSubscriptionError)) throw error;
  switch (error.code) {
    case "callback_unavailable": throw new ModernMcpError(400, -32015, "Callback verification failed", { reason: error.reason ?? "unreachable" });
    case "invalid_input": throw new ModernMcpError(400, -32602, "Invalid event parameters");
    case "not_found": throw new ModernMcpError(404, -32023, "Event target not found", { kind: "event" });
    case "insufficient_scope": case "connection_unavailable": throw new ModernMcpError(403, -32024, "Event access unavailable");
    case "subscription_limit": throw new ModernMcpError(429, -32025, "Subscription limit reached", { resource: "subscriptions" });
    case "read_conflict": throw new ModernMcpError(409, -32603, "Subscription changed; inspect current monitoring before retrying");
    case "key_unavailable": throw new ModernMcpError(503, -32603, "Subscription key unavailable");
  }
}
export async function runEventMethod(context: McpContext, method: string, params: Record<string, unknown>) {
  const provider = context.events;
  if (!provider) throw new ModernMcpError(404, -32601, "Method not found");
  const authorize = async () => {
    if (!context.config) throw new EventSubscriptionError("connection_unavailable");
    // 定義の発見に購読権限を要すると、追加同意の前にイベントを発見できない。
    const scopes = method === "events/list" ? ["household.read"] as const : ["household.read", "events.subscribe"] as const;
    const auth = await authenticateBearerRequest({ ...context, config: context.config }, context.request, scopes);
    if (!auth.ok) throw new EventSubscriptionError("connection_unavailable");
    return auth.principal;
  };
  try {
    await authorize();
    const input = Object.fromEntries(Object.entries(params).filter(([key]) => key !== "_meta"));
    if (method === "events/list") {
      if (Object.keys(input).some((key) => key !== "cursor") || (input.cursor !== undefined && input.cursor !== null)) throw new EventSubscriptionError("invalid_input");
      return { events: [eventDefinition()] };
    }
    const service = createEventSubscriptionService({ ...context, ...provider, secret: context.cursorSecret, authorize, signal: context.request.signal });
    if (method === "events/subscribe") return await service.subscribe(input);
    if (method === "events/unsubscribe") return await service.unsubscribe(input);
    throw new ModernMcpError(404, -32601, "Method not found");
  } catch (error) { mappedError(error); }
}

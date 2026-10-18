import { COMMAND_NAMES, CommandError } from "../commands/contract";
import { createCommandService } from "../commands/service";
import { createHouseholdReader } from "../read";
import { ReadError } from "../read-contract";
import { createAttentionReader } from "../attention/service";
import { createNotificationReader } from "../notifications/service";
import { authenticateBearerRequest } from "../oauth/bearer";
import type { IntegrationPrincipal } from "../principal";
import type { McpToolName } from "./catalog";
import type { McpContext } from "./server";
import { readIntegrationConnectionProfile } from "../../../lib/d1/integration-connection-profile";
import { MCP_SUPPORTED_VERSIONS } from "./modern-request";
export class McpAuthenticationError extends Error { constructor(readonly response: Response) { super("Authentication required"); } }
async function authorize(context: McpContext): Promise<IntegrationPrincipal> {
  if (!context.config) throw new Error("MCP is disabled");
  const auth = await authenticateBearerRequest({ ...context, config: context.config }, context.request, ["household.read"]);
  if (!auth.ok) throw new McpAuthenticationError(auth.response);
  return auth.principal;
}
async function connection(context: McpContext, principal: IntegrationPrincipal) {
  if (!context.config) throw new Error("MCP is disabled");
  const row = await readIntegrationConnectionProfile(context.db, principal);
  if (!row) throw new ReadError("not_found");
  return { schema_version: 1, request_id: crypto.randomUUID(), as_of: (context.now?.() ?? new Date()).toISOString(),
    connection_management_url: `${context.config.issuer}/settings/integrations`, integration_guide_url: `${context.config.issuer}/settings/integrations/guide`, user_id: principal.userId, household_id: principal.householdId, connection_id: principal.connectionId,
    client_id: principal.clientId, site_origin: context.config.issuer, ...row, scopes: [...principal.scopes], status: "active",
    capabilities: { supported_commands: [...COMMAND_NAMES], events: Boolean(context.events), notification_delivery: false, transport_protocols: [...MCP_SUPPORTED_VERSIONS],
      notification_polling: { supported: true, executor: "connected_client", external_task_status: "unknown", interval_hint_minutes: 15, requires_scopes: ["household.read", "events.subscribe"] },
      unsupported_commands: ["todo.update", "todo.reschedule", "managed_item.update"].filter((name) => !(COMMAND_NAMES as readonly string[]).includes(name)) } };
}
export function createMcpToolService(context: McpContext) {
  const deps = { ...context, authorize: () => authorize(context) };
  const reader = createHouseholdReader(deps);
  const attention = createAttentionReader(deps);
  const notifications = createNotificationReader(deps);
  const commands = createCommandService(deps);
  return {
    async run(name: McpToolName, args: Record<string, unknown>): Promise<Record<string, unknown>> {
      const principal = await authorize(context);
      let result: Record<string, unknown>;
      switch (name) {
        case "connection_get": result = await connection(context, principal); break;
        case "entity_search": result = await reader.entitySearch(args); break;
        case "entity_get": result = await reader.entityGet(args); break;
        case "history_list": result = await reader.historyList(args); break;
        case "attention_get": result = await attention.attentionGet(args); break;
        case "notification_settings_get": result = await notifications.notificationSettingsGet(); break;
        case "delivery_list": result = await notifications.deliveryList(args); break;
        case "notification_context_get": result = await notifications.notificationContextGet(args); break;
        case "command_prepare": result = await commands.prepare(principal, args); break;
        case "command_commit": result = await commands.commit(principal, args); break;
        case "operation_get": result = await commands.get(principal, args); break;
      }
      await authorize(context);
      return result;
    },
  };
}
export function mcpToolError(error: unknown) {
  if (error instanceof CommandError) return error.toWire();
  if (error instanceof ReadError && error.code === "insufficient_scope") return { code: error.code, message: "この操作に必要な権限がありません。OAuthで許可する範囲を確認してください。", retryable: false, recovery: "reconnect" };
  if (error instanceof ReadError) return { code: error.code, message: error.message, retryable: error.retryable, recovery: error.recovery };
  if (error instanceof McpAuthenticationError) return { code: error.response.status === 403 ? "insufficient_scope" : "unauthenticated", message: "接続を確認し、必要ならOAuthで再接続してください。", recovery: "reconnect", retryable: false };
  return { code: "temporarily_unavailable", message: "結果を取得できませんでした。変更操作はoperation_getで確認してから再試行してください。", recovery: "operation_get", retryable: true };
}

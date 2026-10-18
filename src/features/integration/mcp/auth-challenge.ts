import { findIntegrationOperation } from "../../../lib/d1/integration-operations";
import { CommandError } from "../commands/contract";
import { commandScope } from "../commands/command-scope";
import { ReadError } from "../read-contract";
import { bearerErrorResponse } from "../oauth/bearer";
import type { IntegrationScope } from "../scopes";
import type { McpToolName } from "./catalog";
import type { McpContext } from "./server";
import { McpAuthenticationError } from "./service";
async function requiredScopes(context: McpContext, name: McpToolName, args: Record<string, unknown>): Promise<IntegrationScope[]> {
  if (name === "notification_settings_get" || name === "delivery_list" || name === "notification_context_get") return ["notifications.manage"];
  let command = args.command;
  let reference = args.notification_reference !== undefined;
  if (name === "command_commit" || name === "operation_get") {
    const operation = typeof args.operation_id === "string" ? await findIntegrationOperation(context.db, context.principal.connectionId, args.operation_id) : null;
    command = operation?.command;
    reference = operation !== null && (JSON.parse(operation.normalizedCommand) as { notification_reference?: unknown }).notification_reference !== undefined;
  }
  if (reference && name === "operation_get") return ["notifications.manage"];
  const primary = commandScope(typeof command === "string" ? command : "");
  return [...new Set<IntegrationScope>([primary, ...(reference ? ["notifications.manage" as const] : [])])];
}
export async function mcpAuthChallenge(context: McpContext, name: McpToolName, args: Record<string, unknown>, error: unknown) {
  if (error instanceof McpAuthenticationError) return error.response.headers.get("www-authenticate");
  if (!(error instanceof CommandError || error instanceof ReadError) || error.code !== "insufficient_scope" || !context.config) return null;
  return bearerErrorResponse(context.config, ["household.read", ...await requiredScopes(context, name, args)], "insufficient_scope").headers.get("www-authenticate");
}

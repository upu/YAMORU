import { findIntegrationOperation } from "../../../lib/d1/integration-operations";
import { CommandError } from "../commands/contract";
import { ReadError } from "../read-contract";
import { bearerErrorResponse } from "../oauth/bearer";
import type { IntegrationScope } from "../scopes";
import type { McpToolName } from "./catalog";
import type { McpContext } from "./server";
import { McpAuthenticationError } from "./service";
async function missingScope(context: McpContext, name: McpToolName, args: Record<string, unknown>): Promise<IntegrationScope> {
  if (name === "notification_settings_get" || name === "delivery_list") return "notifications.manage";
  let command = args.command;
  if (name === "command_commit" || name === "operation_get") {
    const operation = typeof args.operation_id === "string" ? await findIntegrationOperation(context.db, context.principal.connectionId, args.operation_id) : null;
    command = operation?.command;
  }
  return typeof command === "string" && command.startsWith("notification.") ? "notifications.manage" : "household.write";
}
export async function mcpAuthChallenge(context: McpContext, name: McpToolName, args: Record<string, unknown>, error: unknown) {
  if (error instanceof McpAuthenticationError) return error.response.headers.get("www-authenticate");
  if (!(error instanceof CommandError || error instanceof ReadError) || error.code !== "insufficient_scope" || !context.config) return null;
  return bearerErrorResponse(context.config, ["household.read", await missingScope(context, name, args)], "insufficient_scope").headers.get("www-authenticate");
}

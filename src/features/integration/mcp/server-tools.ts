import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MCP_TOOL_DEFINITIONS, type McpToolName } from "./catalog";
import { mcpOutputSchema } from "./output-schemas";
import { createMcpToolService, mcpToolError } from "./service";
import { mcpAuthChallenge } from "./auth-challenge";
import type { McpContext } from "./server";

export function toolSecuritySchemes(name: McpToolName) {
  const scopes = ["household.read"];
  if (name === "notification_settings_get" || name === "delivery_list" || name === "notification_context_get") scopes.push("notifications.manage");
  return [{ type: "oauth2" as const, scopes }];
}
export function toolAnnotations(tool: typeof MCP_TOOL_DEFINITIONS[number]) {
  return { readOnlyHint: tool.readOnly, destructiveHint: "destructive" in tool && tool.destructive, openWorldHint: false,
    idempotentHint: tool.readOnly || tool.name === "command_prepare" || tool.name === "command_commit" };
}
export function listMcpTools() {
  return MCP_TOOL_DEFINITIONS.map((tool) => ({ name: tool.name, title: tool.title, description: tool.description,
    securitySchemes: toolSecuritySchemes(tool.name), _meta: { securitySchemes: toolSecuritySchemes(tool.name) },
    inputSchema: { ...z.toJSONSchema(tool.schema, { io: "input" }), type: "object" as const },
    outputSchema: { ...z.toJSONSchema(mcpOutputSchema(tool.name)), type: "object" as const }, annotations: toolAnnotations(tool) }));
}
export function createMcpToolRunner(context: McpContext) {
  const service = createMcpToolService(context);
  return async (name: McpToolName, args: Record<string, unknown>): Promise<CallToolResult> => {
    try {
      const result = await service.run(name, args);
      return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      const result = { error: mcpToolError(error) };
      const challenge = await mcpAuthChallenge(context, name, args, error).catch(() => null);
      return { isError: true, structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }],
        ...(challenge ? { _meta: { "mcp/www_authenticate": [challenge] } } : {}) };
    }
  };
}

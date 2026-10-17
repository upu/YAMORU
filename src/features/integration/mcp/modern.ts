import { MCP_TOOL_DEFINITIONS } from "./catalog";
import { mcpOutputSchema } from "./output-schemas";
import { createMcpToolRunner, listMcpTools } from "./server-tools";
import { MCP_INSTRUCTIONS } from "./instructions";
import { MODERN_MCP_VERSION, MCP_SUPPORTED_VERSIONS, ModernMcpError, modernRequestId, readModernMcpRequest } from "./modern-request";
import { APP_VERSION_INFO } from "../../../app/app-version";
import type { McpContext } from "./server";
import { runEventMethod } from "./server-events";
async function callTool(context: McpContext, params: Record<string, unknown>) {
  const tool = MCP_TOOL_DEFINITIONS.find((entry) => entry.name === params.name);
  if (!tool) throw new ModernMcpError(400, -32602, "Unknown tool");
  const args = tool.schema.safeParse(params.arguments ?? {});
  if (!args.success) throw new ModernMcpError(400, -32602, "Invalid tool arguments");
  const result = await createMcpToolRunner(context)(tool.name, args.data);
  if (!result.isError && !mcpOutputSchema(tool.name).safeParse(result.structuredContent).success) throw new ModernMcpError(500, -32603, "Tool output unavailable; check operation_get before retrying a write");
  return result;
}
async function resultFor(context: McpContext, method: string, params: Record<string, unknown>) {
  switch (method) {
    case "server/discover": return { supportedVersions: [...MCP_SUPPORTED_VERSIONS], capabilities: { tools: {}, ...(context.events ? { events: {} } : {}) }, instructions: MCP_INSTRUCTIONS };
    case "tools/list": return { tools: listMcpTools() };
    case "tools/call": return callTool(context, params);
    case "events/list": case "events/subscribe": case "events/unsubscribe": return runEventMethod(context, method, params);
    default: throw new ModernMcpError(404, -32601, "Method not found");
  }
}
export async function handleModernMcpRequest(context: McpContext, body: unknown) {
  const headers = { "mcp-protocol-version": MODERN_MCP_VERSION };
  try {
    const rpc = readModernMcpRequest(context.request, body);
    const result = await resultFor(context, rpc.method, rpc.params);
    const oldMeta = "_meta" in result && typeof result._meta === "object" && result._meta !== null ? result._meta : {};
    return Response.json({ jsonrpc: "2.0", id: rpc.id, result: { ...result, resultType: "complete", _meta: { ...oldMeta,
      "io.modelcontextprotocol/serverInfo": { name: "YAMORU", version: APP_VERSION_INFO.version } } } }, { headers });
  } catch (error) {
    if (!(error instanceof ModernMcpError)) throw error;
    return Response.json({ jsonrpc: "2.0", id: modernRequestId(body), error: { code: error.code, message: error.message, ...(error.data ? { data: error.data } : {}) } }, { status: error.status, headers });
  }
}

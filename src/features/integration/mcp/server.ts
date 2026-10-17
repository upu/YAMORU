import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker-provider.js";
import type { IntegrationPrincipal } from "../principal";
import type { McpDependencies } from "./http";
import { MCP_TOOL_DEFINITIONS } from "./catalog";
import { APP_VERSION_INFO } from "../../../app/app-version";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { mcpOutputSchema } from "./output-schemas";
import { createMcpToolRunner, listMcpTools, toolAnnotations, toolSecuritySchemes } from "./server-tools";
import { MCP_INSTRUCTIONS } from "./instructions";

export type McpContext = McpDependencies & { request: Request; principal: IntegrationPrincipal };
export function createMcpServer(context: McpContext) {
  const server = new McpServer({ name: "YAMORU", version: APP_VERSION_INFO.version }, { instructions: MCP_INSTRUCTIONS, maxToolInputElements: 1000,
    jsonSchemaValidator: new CfWorkerJsonSchemaValidator() });
  const run = createMcpToolRunner(context);
  for (const tool of MCP_TOOL_DEFINITIONS) {
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: tool.schema,
      outputSchema: mcpOutputSchema(tool.name), _meta: { securitySchemes: toolSecuritySchemes(tool.name) }, annotations: toolAnnotations(tool) },
    (args: Record<string, unknown>) => run(tool.name, args));
  }
  // SDKの標準一覧はroot unionを空のobjectへ変えるため、公開schemaを明示する。
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: listMcpTools() }));
  server.server.registerCapabilities({ tools: { listChanged: false } });
  return server;
}

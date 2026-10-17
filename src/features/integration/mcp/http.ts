import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateBearerRequest } from "../oauth/bearer";
import type { OAuthConfig } from "../oauth/config";
import { declaresTooLargeBody, readTextWithLimit } from "../oauth/limited-body";
import { createMcpServer, type McpContext } from "./server";
import { handleModernMcpRequest } from "./modern";
import { isModernMcpRequest } from "./modern-request";
import { acquireMcpBudget, releaseMcpLease, mcpCommitGuard, type McpBudgetCategory } from "../../../lib/d1/integration-mcp-limits";
import type { PinnedWebhookTransport } from "../notifications/webhook-transport";

export type McpDependencies = { config: OAuthConfig | null; db: D1Database; cursorSecret: string; now?: () => Date; allowedOrigins?: readonly string[]; commitGuard?: D1PreparedStatement;
  events?: { providerId: string; transport: PinnedWebhookTransport } };
const MAX_BODY_BYTES = 65_536;
function jsonError(status: number, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id: null, error: { code, message } }, { status });
}
function responseHeaders(response: Response, origin: string | null) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-expose-headers", "WWW-Authenticate, MCP-Protocol-Version, Retry-After");
    headers.append("vary", "Origin");
  }
  return new Response(response.body, { status: response.status, headers });
}
async function bodyOf(request: Request): Promise<{ parsedBody: unknown } | Response> {
  if (declaresTooLargeBody(request.headers, MAX_BODY_BYTES)) return jsonError(413, -32600, "Request body too large");
  const body = await readTextWithLimit(request.body, MAX_BODY_BYTES);
  if (body === null) return jsonError(413, -32600, "Request body too large");
  let parsedBody: unknown;
  try { parsedBody = JSON.parse(body) as unknown; }
  catch { return jsonError(400, -32700, "Parse error"); }
  if (Array.isArray(parsedBody)) return jsonError(400, -32600, "Batch requests are not supported");
  return { parsedBody };
}
function budgetCategory(body: unknown): McpBudgetCategory {
  const parsed = body as { method?: unknown; params?: { name?: unknown } } | null;
  const name = parsed?.method === "tools/call" ? parsed.params?.name : null;
  return parsed?.method === "events/subscribe" || parsed?.method === "events/unsubscribe" || name === "command_commit" ? "commit" : name === "command_prepare" ? "prepare" : "read";
}
async function legacyResponse(context: McpContext, body: { parsedBody: unknown }) {
  const server = createMcpServer(context);
  try {
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true, maxRequestBodySize: MAX_BODY_BYTES });
    await server.connect(transport);
    return await transport.handleRequest(context.request, body);
  } finally { await server.close(); }
}
async function eventAuthorization(request: Request, deps: McpDependencies & { config: OAuthConfig }, body: unknown) {
  const method = (body as { method?: unknown } | null)?.method;
  if (!deps.events || typeof method !== "string" || !method.startsWith("events/")) return null;
  const auth = await authenticateBearerRequest(deps, request, ["household.read", "events.subscribe"]);
  return auth.ok ? null : auth.response;
}
async function authorizedRequest(request: Request, deps: McpDependencies & { config: OAuthConfig }): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
    "access-control-allow-methods": "POST, GET, DELETE, OPTIONS", "access-control-allow-headers": "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name", "access-control-max-age": "600",
  } });
  const auth = await authenticateBearerRequest(deps, request, ["household.read"]);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST, OPTIONS" } });
  const body = await bodyOf(request);
  if (body instanceof Response) return body;
  const eventsDenied = await eventAuthorization(request, deps, body.parsedBody);
  if (eventsDenied) return eventsDenied;
  const budget = await acquireMcpBudget(deps.db, auth.principal, budgetCategory(body.parsedBody), deps.now?.() ?? new Date());
  if (!budget.ok) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Rate limited; wait and check operation_get before retrying a write", data: { code: "rate_limited", retryable: true } } }, { status: 429, headers: { "retry-after": String(budget.retryAfter) } });
  try {
    const context = { ...deps, request, principal: auth.principal, ...(budget.lease ? { commitGuard: mcpCommitGuard(deps.db, budget.lease) } : {}) };
    return isModernMcpRequest(request, body.parsedBody) ? await handleModernMcpRequest(context, body.parsedBody) : await legacyResponse(context, body);
  } finally {
    // 解放だけの失敗で保存済み成功を隠さない。残った枠は期限で回復する。
    if (budget.lease) await releaseMcpLease(deps.db, budget.lease).catch(() => undefined);
  }
}
export async function handleMcpRequest(request: Request, deps: McpDependencies): Promise<Response> {
  if (deps.config === null) return responseHeaders(new Response(null, { status: 404 }), null);
  if (request.signal.aborted) return responseHeaders(jsonError(408, -32603, "Request interrupted; check operation_get before retrying a write"), null);
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== deps.config.issuer && !deps.allowedOrigins?.includes(origin)) return responseHeaders(new Response(null, { status: 403 }), null);
  try { return responseHeaders(await authorizedRequest(request, { ...deps, config: deps.config }), origin); }
  catch { return responseHeaders(jsonError(503, -32603, "Temporarily unavailable; check operation_get before retrying a write"), origin); }
}

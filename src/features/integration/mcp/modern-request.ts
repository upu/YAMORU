import { z } from "zod";
export const MODERN_MCP_VERSION = "2026-07-28";
export const MCP_SUPPORTED_VERSIONS = [MODERN_MCP_VERSION, "2025-11-25"] as const;
const legacyVersions = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"];
export class ModernMcpError extends Error {
  constructor(readonly status: number, readonly code: number, message: string, readonly data?: Record<string, unknown>) { super(message); }
}
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function isModernMcpRequest(request: Request, body: unknown) {
  const meta = record(record(record(body).params)._meta);
  const version = request.headers.get("mcp-protocol-version");
  return meta["io.modelcontextprotocol/protocolVersion"] !== undefined || (version !== null && !legacyVersions.includes(version)) || record(body).method === "server/discover";
}
function boundedElements(body: unknown) {
  const stack = [body];
  let count = 0;
  while (stack.length) {
    if (++count > 1000) throw new ModernMcpError(400, -32602, "Too many input elements");
    const value = stack.pop();
    if (Array.isArray(value)) stack.push(...value as unknown[]);
    else if (value !== null && typeof value === "object") stack.push(...Object.values(record(value)));
  }
}
function decodeName(value: string | null) {
  if (value === null || value.length > 4096) return null;
  if (!value.startsWith("=?base64?") || !value.endsWith("?=")) return value;
  try {
    const encoded = value.slice(9, -2);
    const decoded = atob(encoded);
    if (btoa(decoded) !== encoded) return null;
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(decoded, (character) => character.charCodeAt(0)));
  } catch { return null; }
}
function headerMismatch() { throw new ModernMcpError(400, -32020, "Required MCP headers are missing, malformed or do not match the request body"); }
function validateHeaders(request: Request, method: string, params: Record<string, unknown>) {
  const version = record(params._meta)["io.modelcontextprotocol/protocolVersion"];
  if (typeof version !== "string" || request.headers.get("mcp-protocol-version") !== version || request.headers.get("mcp-method") !== method) headerMismatch();
  if (method === "tools/call" || method === "prompts/get" || method === "events/subscribe" || method === "events/unsubscribe") {
    if (typeof params.name !== "string" || decodeName(request.headers.get("mcp-name")) !== params.name) headerMismatch();
  }
  if (method === "resources/read" && (typeof params.uri !== "string" || decodeName(request.headers.get("mcp-name")) !== params.uri)) headerMismatch();
  return version;
}
function validateContent(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new ModernMcpError(415, -32600, "Content-Type must be application/json");
  const accepted = (request.headers.get("accept") ?? "").toLowerCase().split(",")
    .filter((entry) => !/;\s*q=0(?:\.0*)?\s*(?:;|$)/u.test(entry)).map((entry) => entry.trim().split(";")[0]);
  if (!accepted.includes("application/json") || !accepted.includes("text/event-stream")) throw new ModernMcpError(406, -32600, "Accept must include application/json and text/event-stream");
}
const envelopeSchema = z.strictObject({ jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number()]), method: z.string(), params: z.record(z.string(), z.unknown()) });
const metaSchema = z.looseObject({ "io.modelcontextprotocol/protocolVersion": z.string(), "io.modelcontextprotocol/clientCapabilities": z.record(z.string(), z.unknown()),
  "io.modelcontextprotocol/clientInfo": z.looseObject({ name: z.string(), version: z.string() }).optional() });
export function readModernMcpRequest(request: Request, body: unknown) {
  boundedElements(body);
  const parsed = envelopeSchema.safeParse(body);
  if (!parsed.success) throw new ModernMcpError(400, -32600, "Invalid JSON-RPC request");
  const rpc = parsed.data;
  const version = validateHeaders(request, rpc.method, rpc.params);
  if (version !== MODERN_MCP_VERSION) throw new ModernMcpError(400, -32022, "Unsupported protocol version", { supported: [...MCP_SUPPORTED_VERSIONS], requested: version });
  if (!metaSchema.safeParse(rpc.params._meta).success) throw new ModernMcpError(400, -32602, "Each request must include valid protocol metadata and clientCapabilities");
  validateContent(request);
  return rpc;
}
export function modernRequestId(body: unknown) {
  const id = record(body).id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

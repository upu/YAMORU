import { handleMcpRequest } from "../../features/integration/mcp/http";
import { getMcpRuntime } from "../../features/integration/mcp/runtime";
export const dynamic = "force-dynamic";
async function handle(request: Request): Promise<Response> {
  try { return await handleMcpRequest(request, await getMcpRuntime()); }
  catch { return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Temporarily unavailable; check operation_get before retrying a write" } }, { status: 503, headers: { "cache-control": "no-store" } }); }
}
export { handle as POST, handle as GET, handle as DELETE, handle as OPTIONS };

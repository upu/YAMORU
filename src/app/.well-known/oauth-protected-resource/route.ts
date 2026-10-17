import { metadataResponse, protectedResourceMetadata } from "../../../features/integration/oauth/metadata";
import { getOAuthRuntime } from "../../../features/integration/oauth/runtime";
import { notFoundResponse } from "../../../features/integration/oauth/token-endpoint";

export const dynamic = "force-dynamic";

// MCPクライアントは/mcpを挿入したパス(./mcp/route.ts)を先に探し、無ければ
// ここを読む。どちらも同じresource(MCPサーバーの正規URI)を返す。
export async function GET(): Promise<Response> {
  const { config } = await getOAuthRuntime();
  return config === null ? notFoundResponse() : metadataResponse(protectedResourceMetadata(config));
}

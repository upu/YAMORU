import { metadataResponse, protectedResourceMetadata } from "../../../../features/integration/oauth/metadata";
import { getOAuthRuntime } from "../../../../features/integration/oauth/runtime";
import { notFoundResponse } from "../../../../features/integration/oauth/token-endpoint";

export const dynamic = "force-dynamic";

// RFC 9728のpath挿入形式(/.well-known/oauth-protected-resource/mcp)。
export async function GET(): Promise<Response> {
  const { config } = await getOAuthRuntime();
  return config === null ? notFoundResponse() : metadataResponse(protectedResourceMetadata(config));
}

import { authorizationServerMetadata, metadataResponse } from "../../../features/integration/oauth/metadata";
import { getOAuthRuntime } from "../../../features/integration/oauth/runtime";
import { notFoundResponse } from "../../../features/integration/oauth/token-endpoint";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const { config } = await getOAuthRuntime();
  return config === null ? notFoundResponse() : metadataResponse(authorizationServerMetadata(config));
}

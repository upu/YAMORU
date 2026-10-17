import { getOAuthRuntime } from "../../../features/integration/oauth/runtime";
import { handleTokenRequest } from "../../../features/integration/oauth/token-endpoint";

export async function POST(request: Request): Promise<Response> {
  return handleTokenRequest(request, await getOAuthRuntime());
}

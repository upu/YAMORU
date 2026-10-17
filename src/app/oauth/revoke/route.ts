import { handleRevocationRequest } from "../../../features/integration/oauth/revocation-endpoint";
import { getOAuthRuntime } from "../../../features/integration/oauth/runtime";

export async function POST(request: Request): Promise<Response> {
  return handleRevocationRequest(request, await getOAuthRuntime());
}

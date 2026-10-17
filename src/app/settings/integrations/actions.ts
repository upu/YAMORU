"use server";

import { revalidatePath } from "next/cache";

import { getD1Context } from "../../../lib/d1/context";
import { revokeConnectionForUser } from "../../../lib/d1/oauth-connections";
import { logOAuthEvent } from "../../../features/integration/oauth/log";
import type { RevokeConnectionState } from "./state";

const REVOKE_FAILED: RevokeConnectionState = {
  message: "連携を解除できませんでした。時間をおいて再度お試しください。",
  status: "error",
};

// 本人の接続だけを解除できる。他人の接続IDを送っても0件で、存在を明かさない。
export async function revokeConnectionAction(
  _previousState: RevokeConnectionState,
  formData: FormData,
): Promise<RevokeConnectionState> {
  const connectionId = formData.get("connectionId");
  if (typeof connectionId !== "string" || connectionId.length === 0) return REVOKE_FAILED;
  try {
    const { db, session } = await getD1Context();
    const revoked = await revokeConnectionForUser(db, session, connectionId, new Date().toISOString());
    if (revoked) logOAuthEvent({ connectionId, event: "connection_revoked", reason: "user_revoked" });
  } catch {
    return REVOKE_FAILED;
  }
  revalidatePath("/settings/integrations");
  return { message: "", status: "idle" };
}

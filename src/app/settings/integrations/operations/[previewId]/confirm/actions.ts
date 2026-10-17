"use server";

import { revalidatePath } from "next/cache";

import { getD1Context } from "../../../../../../lib/d1/context";
import {
  approveConfirmation,
  denyConfirmation,
  type ConfirmationDecision,
} from "../../../../../../lib/d1/integration-confirmations";
import type { ConfirmOperationState } from "./state";

// 外部commandの追加確認(YDR-062)。承認・拒否はPOST(Server Action)だけで
// 記録し、GETでは何も変えない。本人・家庭・未実行・期限内・世代の確認は
// D1側の条件付き更新で行う。Server ActionはNext.jsがOriginを検証する。

const MESSAGES: Record<ConfirmationDecision, ConfirmOperationState> = {
  approved: { message: "承認しました。元の会話に戻って、操作を続けるよう伝えてください。", status: "done" },
  denied: { message: "この変更を取りやめました。元の会話に戻ってください。", status: "done" },
  expired: { message: "確認の期限が切れました。元の会話で、もう一度内容を確かめてから操作し直してください。", status: "error" },
  not_pending: { message: "この変更はすでに確認済みか、確認できない状態です。最新の表示を確認してください。", status: "error" },
  stale: { message: "確認している間に家庭の内容が変わったため、承認しませんでした。元の会話で作り直してください。", status: "error" },
};

const FAILED: ConfirmOperationState = {
  message: "確認を記録できませんでした。時間をおいて再度お試しください。",
  status: "error",
};

export async function decideOperationAction(
  _previousState: ConfirmOperationState,
  formData: FormData,
): Promise<ConfirmOperationState> {
  const previewId = formData.get("previewId");
  const decision = formData.get("decision");
  if (typeof previewId !== "string" || previewId.length === 0 || (decision !== "approve" && decision !== "deny")) return FAILED;
  let result: ConfirmationDecision;
  try {
    const { db, session } = await getD1Context();
    const at = new Date().toISOString();
    result = decision === "approve"
      ? await approveConfirmation(db, session, previewId, at)
      : await denyConfirmation(db, session, previewId, at);
  } catch {
    return FAILED;
  }
  revalidatePath(`/settings/integrations/operations/${encodeURIComponent(previewId)}/confirm`);
  return MESSAGES[result];
}

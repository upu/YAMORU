"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { requireUser } from "../../../../lib/auth/current-user";
import {
  INVITE_CLAIM_COOKIE_NAME,
  INVITE_CLAIM_COOKIE_PATH,
} from "../../../../lib/invitations/claim-cookie";
import { createServiceRoleClient } from "../../../../lib/supabase/service-role";
import type { AcceptInvitationState } from "./state";

// 受諾に必要なclaim secretはcookieからserver actionが直接読むため、
// useActionStateが渡すstate・formDataのいずれも使わない。
//
// Issue #70: accept_household_invitation_by_claimはservice_role専用境界に
// 移した。呼び出し元(このServer Action)がrequireUser()でAuth検証済みの
// 利用者IDを取得し、明示的に渡す(RPC内ではauth.uid()が使えないため)。
// 失敗種別はraise exceptionではなく戻り値のresult_codeで返る(DB側の理由は
// マイグレーションのコメント参照)。
export async function acceptInvitationClaim(): Promise<AcceptInvitationState> {
  const cookieStore = await cookies();
  const claimSecret = cookieStore.get(INVITE_CLAIM_COOKIE_NAME)?.value;

  if (claimSecret === undefined) {
    return { kind: "invalid", status: "error" };
  }

  const user = await requireUser();
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("accept_household_invitation_by_claim", {
    p_user_id: user.id,
    claim_secret: claimSecret,
  });

  // 成功・失敗いずれの結果でも、この画面での受諾試行は一度きりとして扱い、
  // claim cookieを使い切る(YDR-019「単回使用」の趣旨。DB側のclaim自体は
  // 受諾成立時だけ消費済みになるが、cookie側は再提示を防ぐ)。
  cookieStore.delete({ name: INVITE_CLAIM_COOKIE_NAME, path: INVITE_CLAIM_COOKIE_PATH });

  const resultCode = data?.[0]?.result_code;
  if (error !== null || resultCode !== "success") {
    return {
      kind: resultCode === "cross_household" ? "cross-household" : "invalid",
      status: "error",
    };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

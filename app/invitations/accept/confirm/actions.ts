"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  INVITE_CLAIM_COOKIE_NAME,
  INVITE_CLAIM_COOKIE_PATH,
} from "../../../../lib/invitations/claim-cookie";
import { createClient } from "../../../../lib/supabase/server";
import type { AcceptInvitationState } from "./state";

// household_members.user_idの一人一家庭制約に基づく、accept_household_invitation_by_claim
// の「既に別の家庭に所属している」エラー(YDR-019「一人一家庭制約下での受諾結果」)。
const CROSS_HOUSEHOLD_ERROR_CODE = "P0002";

// 受諾に必要なclaim secretはcookieからserver actionが直接読むため、
// useActionStateが渡すstate・formDataのいずれも使わない。
export async function acceptInvitationClaim(): Promise<AcceptInvitationState> {
  const cookieStore = await cookies();
  const claimSecret = cookieStore.get(INVITE_CLAIM_COOKIE_NAME)?.value;

  if (claimSecret === undefined) {
    return { kind: "invalid", status: "error" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_household_invitation_by_claim", {
    claim_secret: claimSecret,
  });

  // 成功・失敗いずれの結果でも、この画面での受諾試行は一度きりとして扱い、
  // claim cookieを使い切る(YDR-019「単回使用」の趣旨。DB側のclaim自体は
  // 失敗時raiseされない限り消費済みにならないが、cookie側は再提示を防ぐ)。
  cookieStore.delete({ name: INVITE_CLAIM_COOKIE_NAME, path: INVITE_CLAIM_COOKIE_PATH });

  if (error !== null) {
    return {
      kind: error.code === CROSS_HOUSEHOLD_ERROR_CODE ? "cross-household" : "invalid",
      status: "error",
    };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getD1Context } from "../../../../lib/d1/context";
import { acceptInvitationForExistingUser } from "../../../../lib/d1/invitations";
import {
  INVITE_CLAIM_COOKIE_NAME,
  INVITE_CLAIM_COOKIE_PATH,
} from "../../../../lib/invitations/claim-cookie";
import type { AcceptInvitationState } from "./state";

export async function acceptInvitationClaim(): Promise<AcceptInvitationState> {
  const cookieStore = await cookies();
  const claimSecret = cookieStore.get(INVITE_CLAIM_COOKIE_NAME)?.value;

  if (claimSecret === undefined) {
    return { kind: "invalid", status: "error" };
  }

  const { db, session } = await getD1Context();
  const accepted = await acceptInvitationForExistingUser(db, session, claimSecret);

  // ここから先はドメイン結果(result_code)が確定しているため、この画面での
  // 受諾試行は一度きりとして扱い、claim cookieを使い切る(YDR-019「単回使用」
  // の趣旨。DB側のclaim自体は受諾成立時だけ消費済みになるが、cookie側は
  // 再提示を防ぐ)。
  cookieStore.delete({ name: INVITE_CLAIM_COOKIE_NAME, path: INVITE_CLAIM_COOKIE_PATH });

  if (!accepted) return { kind: "invalid", status: "error" };

  revalidatePath("/", "layout");
  redirect("/");
}

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

  // 期待される受諾失敗では、Server Actionの状態が画面へ反映されるまで
  // claim cookieを残す。先に削除するとroute segmentの再実行時に共通エラーへ
  // 切り替わり、ボタンが返した具体的なinlineエラーを表示できない。
  if (!accepted) return { kind: "invalid", status: "error" };

  cookieStore.delete({ name: INVITE_CLAIM_COOKIE_NAME, path: INVITE_CLAIM_COOKIE_PATH });
  revalidatePath("/", "layout");
  redirect("/");
}

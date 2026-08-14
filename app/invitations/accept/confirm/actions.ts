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

  // RPC自体が失敗するのは、DB接続断や想定外のトリガー失敗など、招待の状態とは
  // 無関係な内部エラーの場合だけである(有効・無効・レート制限などのドメイン
  // 結果はすべてresult_codeとして正常応答で返る、DB側マイグレーションのコメント
  // 参照)。ここでcookieを消費して共通エラーへ畳み込むと、一時的な障害を
  // 「この招待は無効」と表示したまま利用者の再試行手段(cookie)を失わせて
  // しまう(Codexレビュー指摘)ため、cookieを残したまま例外として伝播させる。
  if (error !== null) {
    throw new Error("招待の受諾に失敗しました。時間をおいて再試行してください。");
  }

  // ここから先はドメイン結果(result_code)が確定しているため、この画面での
  // 受諾試行は一度きりとして扱い、claim cookieを使い切る(YDR-019「単回使用」
  // の趣旨。DB側のclaim自体は受諾成立時だけ消費済みになるが、cookie側は
  // 再提示を防ぐ)。
  cookieStore.delete({ name: INVITE_CLAIM_COOKIE_NAME, path: INVITE_CLAIM_COOKIE_PATH });

  const resultCode = data[0]?.result_code;
  if (resultCode !== "success") {
    return {
      kind: resultCode === "cross_household" ? "cross-household" : "invalid",
      status: "error",
    };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

import type { createClient } from "./server";

// 完了ダイアログで「実施した人」として表示する、現在ログイン中の利用者の
// ニックネーム。プロフィール未登録などで解決できない場合のフォールバック。
export const FALLBACK_SELF_ACTOR_NAME = "あなた";

// 「最近の実施」「最後にいつ・誰が」は操作した本人とは限らない(Issue #36)ため、
// 現在の利用者向けのFALLBACK_SELF_ACTOR_NAMEとは別の中立的なフォールバックを使う。
export const FALLBACK_OTHER_MEMBER_NAME = "メンバー";

export async function loadActorName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  fallback: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("nickname")
    .eq("user_id", userId)
    .maybeSingle();

  if (error !== null || data === null) return fallback;
  return data.nickname;
}

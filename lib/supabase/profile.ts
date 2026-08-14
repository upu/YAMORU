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

export type HouseholdMemberOption = { nickname: string; userId: string };

// Todoの担当者選択(Issue #72)で、同じ家庭のメンバー一覧をニックネーム付きで返す。
// household_membersとprofilesは別々のRLSポリシーで守られているため2段階で取得する
// (ホームの実施者名解決と同じ方針)。
//
// 取得失敗をここで空配列へ握りつぶすと、既に担当者が設定済みのOccurrenceでも
// AssigneePanelの選択肢に該当利用者のoptionが存在せず、ブラウザが黙って先頭の
// 「誰でも可」を選択済み表示にしてしまう(実際は担当者が設定されたまま)。
// 家庭に本当にメンバーがいない場合と取得エラーを区別し、エラーは呼び出し元の
// 他クエリ(loadHomeSectionsなど)と同じく例外にする。
export async function loadHouseholdMembers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string,
): Promise<HouseholdMemberOption[]> {
  const { data: memberRows, error: memberError } = await supabase
    .from("household_members")
    .select("user_id")
    .eq("household_id", householdId)
    .order("created_at", { ascending: true });

  if (memberError !== null) {
    throw new Error("家庭メンバーを取得できませんでした。");
  }
  if (memberRows.length === 0) return [];

  const userIds = memberRows.map((row) => row.user_id);
  const { data: profileRows, error: profileError } = await supabase
    .from("profiles")
    .select("user_id, nickname")
    .in("user_id", userIds);

  if (profileError !== null) {
    throw new Error("家庭メンバーのニックネームを取得できませんでした。");
  }

  const nicknameByUserId = new Map(
    profileRows.map((row) => [row.user_id, row.nickname]),
  );
  return userIds.map((userId) => ({
    nickname: nicknameByUserId.get(userId) ?? FALLBACK_OTHER_MEMBER_NAME,
    userId,
  }));
}

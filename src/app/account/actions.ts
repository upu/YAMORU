"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { toSafeRedirectPath } from "../../lib/auth/safe-redirect";
import { getD1Context } from "../../lib/d1/context";
import {
  createProfile,
  updateProfile,
} from "../../lib/d1/households";
import type {
  NicknameActionState,
  NicknameEditActionState,
} from "./state";

const NICKNAME_MAX_LENGTH = 20;

function invalidNickname(): NicknameActionState {
  return {
    message: "ニックネームは1文字以上20文字以内で入力してください。",
    status: "error",
  };
}

export async function registerNickname(
  _previousState: NicknameActionState,
  formData: FormData,
): Promise<NicknameActionState> {
  const rawNickname = formData.get("nickname");
  if (typeof rawNickname !== "string") return invalidNickname();
  const next = toSafeRedirectPath(formData.get("next"));

  const nickname = rawNickname.trim();
  if (
    nickname.length === 0 ||
    Array.from(nickname).length > NICKNAME_MAX_LENGTH
  ) {
    return invalidNickname();
  }

  try {
    const { db, session } = await getD1Context();
    await createProfile(db, session, nickname);
  } catch {
    return {
      message: "ニックネームを登録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  revalidatePath("/account");
  redirect(next ?? "/household");
}

export async function updateNickname(
  _previousState: NicknameEditActionState,
  formData: FormData,
): Promise<NicknameEditActionState> {
  const rawNickname = formData.get("nickname");
  if (typeof rawNickname !== "string") return invalidNickname();

  const nickname = rawNickname.trim();
  if (
    nickname.length === 0 ||
    Array.from(nickname).length > NICKNAME_MAX_LENGTH
  ) {
    return invalidNickname();
  }

  try {
    const { db, session } = await getD1Context();
    await updateProfile(db, session, nickname);
  } catch {
    return {
      message: "ニックネームを変更できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  // 変更後の名前は同じ家庭の履歴・メンバー表示(実施者名、担当者選択肢など)にも
  // 反映される必要がある(Issue #76)ため、/accountだけでなくアプリ全体を
  // 再検証する(ログイン・招待受諾と同じ方針)。
  revalidatePath("/", "layout");

  return { message: "ニックネームを変更しました。", status: "success" };
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { toSafeRedirectPath } from "../../lib/auth/safe-redirect";
import { createClient } from "../../lib/supabase/server";
import type { HouseholdActionState, NicknameActionState } from "./state";

const HOUSEHOLD_NAME_MAX_LENGTH = 100;
const NICKNAME_MAX_LENGTH = 20;
const UNIQUE_VIOLATION = "23505";

function invalidHouseholdName(): HouseholdActionState {
  return {
    message: "家庭名は1文字以上100文字以内で入力してください。",
    status: "error",
  };
}

function invalidNickname(): NicknameActionState {
  return {
    message: "ニックネームは1文字以上20文字以内で入力してください。",
    status: "error",
  };
}

export async function createFirstHousehold(
  _previousState: HouseholdActionState,
  formData: FormData,
): Promise<HouseholdActionState> {
  const rawName = formData.get("householdName");
  if (typeof rawName !== "string") return invalidHouseholdName();

  const householdName = rawName.trim();
  if (
    householdName.length === 0 ||
    Array.from(householdName).length > HOUSEHOLD_NAME_MAX_LENGTH
  ) {
    return invalidHouseholdName();
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_first_household", {
    household_name: householdName,
  });

  if (error !== null) {
    return {
      message: "家庭を作成できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  revalidatePath("/account");
  redirect("/account");
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

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").insert({ nickname });

  // 23505(一意制約違反)は二重送信などで既に登録済みの場合。冪等に成功として扱う。
  if (error !== null && error.code !== UNIQUE_VIOLATION) {
    return {
      message: "ニックネームを登録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  revalidatePath("/account");
  redirect(next ?? "/account");
}

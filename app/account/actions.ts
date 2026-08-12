"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "../../lib/supabase/server";
import type { HouseholdActionState } from "./state";

const HOUSEHOLD_NAME_MAX_LENGTH = 100;

function invalidHouseholdName(): HouseholdActionState {
  return {
    message: "家庭名は1文字以上100文字以内で入力してください。",
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

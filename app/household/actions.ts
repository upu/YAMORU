"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getD1Context } from "../../lib/d1/context";
import { createFirstHousehold as createFirstHouseholdInD1 } from "../../lib/d1/households";
import type { HouseholdActionState } from "../account/state";

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

  try {
    const { db, session } = await getD1Context();
    await createFirstHouseholdInD1(db, session, householdName);
  } catch {
    return {
      message: "家庭を作成できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

"use server";

import { revalidatePath } from "next/cache";

import { tokyoDateFromIso } from "../../lib/d1/calendar";
import { recordConsumableRefill as recordConsumableRefillInD1 } from "../../lib/d1/consumables";
import { getD1Context } from "../../lib/d1/context";

export type ConsumableRefillActionState = {
  message: string;
  status: "error" | "idle" | "success";
};

export async function recordConsumableRefill(
  _previousState: ConsumableRefillActionState,
  formData: FormData,
): Promise<ConsumableRefillActionState> {
  const rawId = formData.get("id");
  if (typeof rawId !== "string" || rawId.trim() === "") {
    return { message: "消耗品を確認できませんでした。", status: "error" };
  }
  const id = rawId.trim();
  const refilledOn = tokyoDateFromIso(new Date().toISOString());

  try {
    const { db, session } = await getD1Context();
    await recordConsumableRefillInD1(db, session, id, refilledOn);
  } catch {
    return {
      message: "補充を記録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  revalidatePath("/");
  revalidatePath("/consumables");
  revalidatePath(`/consumables/${encodeURIComponent(id)}`);
  return {
    message: "補充を記録し、在庫を「ある」に更新しました。",
    status: "success",
  };
}

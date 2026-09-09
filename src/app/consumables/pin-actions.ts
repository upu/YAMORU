"use server";

import { revalidatePath } from "next/cache";

import { setConsumablePinned } from "../../lib/d1/consumable-pins";
import { getD1Context } from "../../lib/d1/context";

export type ConsumablePinActionState = {
  message: string;
  status: "error" | "idle" | "success";
};

export async function updateConsumablePin(
  _previousState: ConsumablePinActionState,
  formData: FormData,
): Promise<ConsumablePinActionState> {
  const rawId = formData.get("id");
  const rawPinned = formData.get("pinned");
  if (
    typeof rawId !== "string"
    || rawId.trim() === ""
    || (rawPinned !== "true" && rawPinned !== "false")
  ) {
    return { message: "ピン留め設定を選び直してください。", status: "error" };
  }
  const id = rawId.trim();
  const pinned = rawPinned === "true";

  try {
    const { db, session } = await getD1Context();
    await setConsumablePinned(db, session, id, pinned);
  } catch {
    return {
      message: "ピン留めを更新できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  revalidatePath("/");
  revalidatePath(`/consumables/${encodeURIComponent(id)}`);
  return {
    message: pinned ? "ホームにピン留めしました。" : "ピン留めを外しました。",
    status: "success",
  };
}

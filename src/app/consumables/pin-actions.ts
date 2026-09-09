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
  const rawFavorite = formData.get("favorite");
  if (
    typeof rawId !== "string"
    || rawId.trim() === ""
    || (rawFavorite !== "true" && rawFavorite !== "false")
  ) {
    return { message: "お気に入り設定を選び直してください。", status: "error" };
  }
  const id = rawId.trim();
  const favorite = rawFavorite === "true";

  try {
    const { db, session } = await getD1Context();
    await setConsumablePinned(db, session, id, favorite);
  } catch {
    return {
      message: "お気に入りを更新できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  revalidatePath("/");
  revalidatePath(`/consumables/${encodeURIComponent(id)}`);
  return {
    message: favorite ? "お気に入りに追加しました。" : "お気に入りから外しました。",
    status: "success",
  };
}

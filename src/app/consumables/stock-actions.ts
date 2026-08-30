"use server";

import { revalidatePath } from "next/cache";

import {
  updateConsumableStockStatus as updateConsumableStockStatusInD1,
  type ConsumableStockStatus,
} from "../../lib/d1/consumables";
import { getD1Context } from "../../lib/d1/context";

export type ConsumableStockActionState = {
  message: string;
  status: "error" | "idle" | "success";
};

const STOCK_STATUSES = new Set<ConsumableStockStatus>(["available", "low", "out"]);

function isStockStatus(value: unknown): value is ConsumableStockStatus {
  return typeof value === "string" && STOCK_STATUSES.has(value as ConsumableStockStatus);
}

export async function updateConsumableStockStatus(
  _previousState: ConsumableStockActionState,
  formData: FormData,
): Promise<ConsumableStockActionState> {
  const rawId = formData.get("id");
  const stockStatus = formData.get("stockStatus");
  if (typeof rawId !== "string" || rawId.trim() === "" || !isStockStatus(stockStatus)) {
    return { message: "在庫状態を選び直してください。", status: "error" };
  }
  const id = rawId.trim();

  try {
    const { db, session } = await getD1Context();
    await updateConsumableStockStatusInD1(db, session, id, stockStatus);
  } catch {
    return {
      message: "在庫状態を更新できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  revalidatePath("/");
  revalidatePath("/consumables");
  revalidatePath(`/consumables/${encodeURIComponent(id)}`);
  return { message: "在庫状態を更新しました。", status: "success" };
}

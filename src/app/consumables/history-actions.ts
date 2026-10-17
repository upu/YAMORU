"use server";
import { revalidatePath } from "next/cache";
import { correctStock } from "../../lib/d1/consumable-stock-history";
import { getD1Context } from "../../lib/d1/context";
import { StockError } from "../../features/consumables/stock-contract";
import { stockWriteMessage, stockWriteOptions } from "./stock-write-input";
import type { ConsumableStockActionState } from "./stock-actions";
export async function correctStockHistory(_previous: ConsumableStockActionState, form: FormData): Promise<ConsumableStockActionState> {
  const id = form.get("id");
  if (typeof id !== "string" || !id) return { status: "error", message: "消耗品を確認できませんでした。" };
  try {
    const options = stockWriteOptions(form);
    if (!options || form.get("recordRevision") === null) throw new StockError("invalid_input");
    const change = form.get("change");
    const patches: Record<string, unknown> = { date: { on: form.get("on") }, status: { status: form.get("status") }, performer: { performerId: form.get("performerId") || null } };
    if (change !== "void" && (typeof change !== "string" || !Object.hasOwn(patches, change))) throw new StockError("invalid_input");
    const current = form.get("currentStatus");
    const { db, session } = await getD1Context();
    await correctStock(db, session, id, { recordId: form.get("recordId"), recordRevision: Number(form.get("recordRevision")),
      ...(change === "void" ? { void: true } : { changes: patches[change] }),
      ...(current ? { currentObservation: { status: current } } : {}) }, options);
  } catch (error) { return { status: "error", message: stockWriteMessage(error, "訂正を保存できませんでした。同じ内容でもう一度お試しください。") }; }
  for (const path of ["/", "/consumables", "/search", `/consumables/${encodeURIComponent(id)}`, `/consumables/${encodeURIComponent(id)}/history`]) revalidatePath(path);
  return { status: "success", message: "元の記録を残して訂正を保存しました。" };
}

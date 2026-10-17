import { StockError } from "../../features/consumables/stock-contract";
export function stockWriteOptions(form: FormData) {
  const operationId = form.get("operationId");
  if (operationId === null) return undefined;
  if (typeof operationId !== "string" || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(operationId)) throw new StockError("invalid_input");
  const raw = form.get("stockRevision");
  if (raw !== null && (typeof raw !== "string" || !/^\d+$/.test(raw))) throw new StockError("invalid_input");
  const expectedRevision = raw === null ? undefined : Number(raw);
  if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) throw new StockError("invalid_input");
  return { operationId, expectedRevision };
}
export function stockWriteMessage(error: unknown, fallback: string) {
  if (error instanceof StockError) {
    if (error.code === "stale_stock") return "家族が在庫を更新しました。画面を読み直してから、もう一度確認してください。";
    if (error.code === "missing_required") return "現在の在庫を確認してください。日付だけでは記録の順序を決められません。";
    if (error.code === "invalid_input") return "日付・状態・実施者を確認してください。";
    if (error.code === "idempotency_conflict") return "操作内容が変わりました。画面を読み直してから記録してください。";
  }
  return fallback;
}

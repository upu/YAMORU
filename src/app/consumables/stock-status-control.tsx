"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { ConsumableStockStatus } from "../../lib/d1/consumables";
import {
  type ConsumableStockActionState,
  updateConsumableStockStatus,
} from "./stock-actions";

const INITIAL_STATE: ConsumableStockActionState = { message: "", status: "idle" };

const STATUS_OPTIONS: { label: string; value: ConsumableStockStatus }[] = [
  { label: "ある", value: "available" },
  { label: "少ない", value: "low" },
  { label: "ない", value: "out" },
];

export function stockStatusLabel(status: ConsumableStockStatus): string {
  return STATUS_OPTIONS.find(({ value }) => value === status)?.label ?? "ある";
}

function StatusButtons({ stockStatus }: { stockStatus: ConsumableStockStatus }) {
  const { pending } = useFormStatus();
  return (
    <div aria-label="在庫状態を変更" className="stock-status-options" role="group">
      {STATUS_OPTIONS.map((option) => (
        <button
          aria-pressed={option.value === stockStatus}
          className="stock-status-option"
          disabled={pending}
          key={option.value}
          name="stockStatus"
          type="submit"
          value={option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function StockStatusControl({
  consumableId,
  stockStatus,
}: {
  consumableId: string;
  stockStatus: ConsumableStockStatus;
}) {
  const [state, formAction] = useActionState(updateConsumableStockStatus, INITIAL_STATE);
  return (
    <section aria-labelledby="consumable-stock-title" className="detail-card">
      <p className="detail-kicker">STOCK</p>
      <h2 id="consumable-stock-title">在庫</h2>
      <p className="stock-status-current">現在: {stockStatusLabel(stockStatus)}</p>
      <form action={formAction}>
        <input name="id" type="hidden" value={consumableId} />
        <StatusButtons stockStatus={stockStatus} />
      </form>
      <p className="input-help">買って補充したら「ある」に戻します。</p>
      {state.status === "idle" ? null : (
        <p className="auth-feedback" role={state.status === "error" ? "alert" : "status"}>
          {state.message}
        </p>
      )}
    </section>
  );
}

"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { ConsumableStockStatus } from "../../lib/d1/consumables";
import {
  type ConsumableStockActionState,
  updateConsumableStockStatus,
} from "./stock-actions";
import { stockStatusLabel } from "./stock-status";

const INITIAL_STATE: ConsumableStockActionState = { message: "", status: "idle" };

const STATUS_OPTIONS: { label: string; value: ConsumableStockStatus }[] = [
  { label: "ある", value: "available" },
  { label: "少ない", value: "low" },
  { label: "ない", value: "out" },
];

function StatusButtons({
  label = "在庫状態を変更",
  stockStatus,
}: {
  label?: string;
  stockStatus: ConsumableStockStatus;
}) {
  const { pending } = useFormStatus();
  return (
    <div aria-label={label} className="stock-status-options" role="group">
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

function StockStatusForm({
  consumableId,
  label,
  stockStatus,
}: {
  consumableId: string;
  label?: string;
  stockStatus: ConsumableStockStatus;
}) {
  const [state, formAction] = useActionState(updateConsumableStockStatus, INITIAL_STATE);
  return (
    <>
      <form action={formAction}>
        <input name="id" type="hidden" value={consumableId} />
        <StatusButtons label={label} stockStatus={stockStatus} />
      </form>
      {state.status === "idle" ? null : (
        <p className="auth-feedback" role={state.status === "error" ? "alert" : "status"}>
          {state.message}
        </p>
      )}
    </>
  );
}

export function QuickStockStatusControl({
  consumableId,
  label,
  stockStatus,
}: {
  consumableId: string;
  label: string;
  stockStatus: ConsumableStockStatus;
}) {
  return (
    <StockStatusForm
      consumableId={consumableId}
      label={label}
      stockStatus={stockStatus}
    />
  );
}

export function StockStatusControl({
  consumableId,
  stockStatus,
}: {
  consumableId: string;
  stockStatus: ConsumableStockStatus;
}) {
  return (
    <section aria-labelledby="consumable-stock-title" className="detail-card">
      <p className="detail-kicker">STOCK</p>
      <h2 id="consumable-stock-title">在庫</h2>
      <p className="stock-status-current">現在: {stockStatusLabel(stockStatus)}</p>
      <StockStatusForm consumableId={consumableId} stockStatus={stockStatus} />
    </section>
  );
}

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

/* Issue #359: 表示密度を優先する場所では、語の代わりに○△×を出して横幅を詰める。
   記号はaria-hiddenにして読み上げ用の語を必ず残す。 */
type StockStatusAppearance = "label" | "symbol";

const STATUS_OPTIONS: {
  label: string;
  symbol: string;
  value: ConsumableStockStatus;
}[] = [
  { label: "ある", symbol: "○", value: "available" },
  { label: "少ない", symbol: "△", value: "low" },
  { label: "ない", symbol: "×", value: "out" },
];

function StatusButtons({
  appearance = "label",
  label = "在庫状態を変更",
  stockStatus,
}: {
  appearance?: StockStatusAppearance;
  label?: string;
  stockStatus: ConsumableStockStatus;
}) {
  const { pending } = useFormStatus();
  return (
    <div aria-label={label} className="stock-status-options" role="group">
      {STATUS_OPTIONS.map((option) => (
        <button
          aria-pressed={option.value === stockStatus}
          className={
            appearance === "symbol"
              ? "stock-status-option stock-status-option-symbol"
              : "stock-status-option"
          }
          disabled={pending}
          key={option.value}
          name="stockStatus"
          type="submit"
          value={option.value}
        >
          {appearance === "symbol" ? (
            <>
              <span aria-hidden="true">{option.symbol}</span>
              <span className="sr-only">{option.label}</span>
            </>
          ) : (
            option.label
          )}
        </button>
      ))}
    </div>
  );
}

function StockStatusForm({
  appearance,
  consumableId,
  label,
  stockStatus,
}: {
  appearance?: StockStatusAppearance;
  consumableId: string;
  label?: string;
  stockStatus: ConsumableStockStatus;
}) {
  const [state, formAction] = useActionState(updateConsumableStockStatus, INITIAL_STATE);
  return (
    <>
      <form action={formAction}>
        <input name="id" type="hidden" value={consumableId} />
        <StatusButtons appearance={appearance} label={label} stockStatus={stockStatus} />
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
  appearance,
  consumableId,
  label,
  stockStatus,
}: {
  appearance?: StockStatusAppearance;
  consumableId: string;
  label: string;
  stockStatus: ConsumableStockStatus;
}) {
  return (
    <StockStatusForm
      appearance={appearance}
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

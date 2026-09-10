"use client";

import { type ReactNode, useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { ConsumableStockStatus } from "../../lib/d1/consumables";
import {
  type ConsumableStockActionState,
  updateConsumableStockStatus,
} from "./stock-actions";
import { stockStatusLabel } from "./stock-status";

const INITIAL_STATE: ConsumableStockActionState = { message: "", status: "idle" };

/* Issue #359: 表示密度を優先する場所では、語の代わりに○△×を出して横幅を詰める。
   記号はaria-hiddenにして読み上げ用の語を必ず残す。
   文字の○△×はフォントによって線の太さや大きさがばらつくので、ほかのアイコンと
   同じ24pxグリッドのSVGで描く。 */
type StockStatusAppearance = "label" | "symbol";

function AvailableIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="7.5" />
    </svg>
  );
}

function LowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 4.6 19.6 18.6H4.4Z" />
    </svg>
  );
}

function OutIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M6.5 6.5 17.5 17.5" />
      <path d="M17.5 6.5 6.5 17.5" />
    </svg>
  );
}

const STATUS_OPTIONS: {
  Icon: () => React.JSX.Element;
  label: string;
  value: ConsumableStockStatus;
}[] = [
  { Icon: AvailableIcon, label: "ある", value: "available" },
  { Icon: LowIcon, label: "少ない", value: "low" },
  { Icon: OutIcon, label: "ない", value: "out" },
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
          className={[
            "stock-status-option",
            `stock-status-option-${option.value}`,
            ...(appearance === "symbol" ? ["stock-status-option-symbol"] : []),
          ].join(" ")}
          disabled={pending}
          key={option.value}
          name="stockStatus"
          type="submit"
          value={option.value}
        >
          {appearance === "symbol" ? (
            <>
              <option.Icon />
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

// Issue #395: 在庫の状態・変更と、在庫を「ある」へ戻す補充を1枚のカードに
// まとめる。消耗品詳細でいちばん重要な状態と操作が、最初のスマホ画面へ収まる。
export function StockStatusControl({
  children,
  consumableId,
  stockStatus,
}: {
  children?: ReactNode;
  consumableId: string;
  stockStatus: ConsumableStockStatus;
}) {
  return (
    <section aria-labelledby="consumable-stock-title" className="detail-card">
      <h2 id="consumable-stock-title">在庫と補充</h2>
      <p className="stock-status-current">現在: {stockStatusLabel(stockStatus)}</p>
      <StockStatusForm consumableId={consumableId} stockStatus={stockStatus} />
      {children}
    </section>
  );
}

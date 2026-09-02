"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { ConsumableRefill } from "../../lib/d1/consumables";
import { formatTokyoDate } from "../time-zone";
import {
  type ConsumableRefillActionState,
  recordConsumableRefill,
} from "./refill-actions";

const INITIAL_STATE: ConsumableRefillActionState = { message: "", status: "idle" };

function RefillButton() {
  const { pending } = useFormStatus();
  return (
    <button className="refill-action-button" disabled={pending} type="submit">
      {pending ? "記録中…" : "補充した"}
    </button>
  );
}

function refillDateLabel(refilledOn: string): string {
  return formatTokyoDate(`${refilledOn}T00:00:00+09:00`);
}

export function ConsumableRefillControl({
  consumableId,
  refills,
}: {
  consumableId: string;
  refills: ConsumableRefill[];
}) {
  const [state, formAction] = useActionState(recordConsumableRefill, INITIAL_STATE);
  return (
    <section aria-labelledby="consumable-refill-title" className="detail-card">
      <p className="detail-kicker">REFILL</p>
      <h2 id="consumable-refill-title">補充</h2>
      <p className="input-help">今日補充したことを記録し、在庫を「ある」に戻します。</p>
      <form action={formAction} className="refill-action-form">
        <input name="id" type="hidden" value={consumableId} />
        <RefillButton />
      </form>
      {state.status === "idle" ? null : (
        <p className="auth-feedback" role={state.status === "error" ? "alert" : "status"}>
          {state.message}
        </p>
      )}

      <h3 className="refill-history-title">補充履歴</h3>
      {refills.length === 0 ? (
        <p className="ledger-empty">補充履歴はありません。</p>
      ) : (
        <ul className="refill-history-list">
          {refills.map((refill) => (
            <li key={refill.id}>{refillDateLabel(refill.refilledOn)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

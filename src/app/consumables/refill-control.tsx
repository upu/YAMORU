"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";

import type { ConsumableRefill } from "../../lib/d1/consumables";
import { stockOccurredLabel } from "./stock-history-labels";
import {
  recordConsumableRefill,
} from "./refill-actions";
import styles from "./refill-control.module.css";
import { useStockAction } from "./use-stock-action";

function RefillButton() {
  const { pending } = useFormStatus();
  return (
    <button className={styles.actionButton} disabled={pending} type="submit">
      {pending ? "記録中…" : "補充した"}
    </button>
  );
}

function refillDateLabel(refilledOn: string): string {
  return stockOccurredLabel(refilledOn, null);
}

export function ConsumableRefillControl({
  consumableId,
  refills,
  stockRevision,
}: {
  consumableId: string;
  refills: ConsumableRefill[];
  stockRevision?: number;
}) {
  const [state, formAction] = useStockAction(recordConsumableRefill, stockRevision);
  return (
    // Issue #395: 補充は在庫を「ある」へ戻す操作なので、独立したカードを持たず
    // 在庫カードの中に置く。カード1枚分の枠と見出しが減り、在庫の状態・変更・
    // 補充・履歴を最初の画面で見渡せるようになる。
    <div>
      <p className="input-help">今日補充したことを記録し、在庫を「ある」に戻します。</p>
      <form action={formAction} className={styles.actionForm}>
        <input name="id" type="hidden" value={consumableId} />
        <RefillButton />
      </form>
      {state.status === "idle" ? null : (
        <p className="auth-feedback" role={state.status === "error" ? "alert" : "status"}>
          {state.message}
        </p>
      )}

      {/* 補充した記録がないうちは、見出しと「ありません」だけの空欄を置かない
      (記録は上の「補充した」から増える)。 */}
      {refills.length === 0 ? null : (
        <>
          <h3 className={styles.historyTitle}>補充履歴</h3>
          <ul className={styles.historyList}>
            {refills.map((refill) => (
              <li key={refill.id}>{refillDateLabel(refill.refilledOn)}</li>
            ))}
          </ul>
        </>
      )}
      <p><Link href={`/consumables/${encodeURIComponent(consumableId)}/history`}>在庫・補充の履歴と訂正</Link></p>
    </div>
  );
}

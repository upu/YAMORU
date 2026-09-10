"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { ConsumableRefill } from "../../lib/d1/consumables";
import { formatTokyoDate } from "../time-zone";
import {
  type ConsumableRefillActionState,
  recordConsumableRefill,
} from "./refill-actions";
import styles from "./refill-control.module.css";

const INITIAL_STATE: ConsumableRefillActionState = { message: "", status: "idle" };

function RefillButton() {
  const { pending } = useFormStatus();
  return (
    <button className={styles.actionButton} disabled={pending} type="submit">
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
    </div>
  );
}

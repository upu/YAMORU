import Link from "next/link";

import type { ConsumableSummary } from "../lib/d1/consumables";
import { HOME_SHOPPING_CANDIDATES_ANCHOR_ID } from "./home-anchors";
import { StockStatusBadge } from "./consumables/stock-status";
import styles from "./shopping-candidates.module.css";

// Issue #398: ホームは素早く確認して操作する画面なので、買い物候補も
// ピン留めと同じ密度の一覧にする。1件ずつ枠で囲まず、名前と在庫状態だけを
// 1行に並べる。「残りが少ない、または切れている消耗品です」という説明文は、
// 各行の「少ない」「ない」のバッジが同じことを示しているため置かない
// (同じ意味を二重に出さない、#394・#396と同じ考え方)。
export function ShoppingCandidatesSection({
  candidates,
}: {
  candidates: ConsumableSummary[];
}) {
  return (
    <section
      aria-labelledby="shopping-candidates-title"
      className="home-section shopping-candidates"
      // Issue #360: ホーム上部サマリーの「買っておきたいもの」から移動する。
      id={HOME_SHOPPING_CANDIDATES_ANCHOR_ID}
    >
      <div className="section-heading">
        <h2 id="shopping-candidates-title">買っておきたいもの</h2>
        <span aria-label={`${String(candidates.length)}件`} className="count">
          {candidates.length}
        </span>
      </div>
      <ul className={styles.list}>
        {candidates.map((candidate) => (
          <li className={styles.item} key={candidate.id}>
            <Link
              className={styles.name}
              href={`/consumables/${encodeURIComponent(candidate.id)}`}
            >
              {candidate.name}
            </Link>
            <StockStatusBadge stockStatus={candidate.stockStatus} />
          </li>
        ))}
      </ul>
    </section>
  );
}

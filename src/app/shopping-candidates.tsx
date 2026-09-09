import Link from "next/link";

import type { ConsumableSummary } from "../lib/d1/consumables";
import { HOME_SHOPPING_CANDIDATES_ANCHOR_ID } from "./home-anchors";
import { StockStatusBadge } from "./consumables/stock-status";

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
        <div>
          <h2 id="shopping-candidates-title">買っておきたいもの</h2>
          <p>残りが少ない、または切れている消耗品です</p>
        </div>
        <span aria-label={`${String(candidates.length)}件`} className="count">
          {candidates.length}
        </span>
      </div>
      <ul className="ledger-list">
        {candidates.map((candidate) => (
          <li key={candidate.id}>
            <Link href={`/consumables/${encodeURIComponent(candidate.id)}`}>
              {candidate.name}
            </Link>
            <StockStatusBadge stockStatus={candidate.stockStatus} />
          </li>
        ))}
      </ul>
    </section>
  );
}

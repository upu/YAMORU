import Link from "next/link";

import type { ConsumableSummary, ConsumableStockStatus } from "../lib/d1/consumables";

function statusLabel(status: ConsumableStockStatus): string {
  return status === "out" ? "ない" : "少ない";
}

export function ShoppingCandidatesSection({
  candidates,
}: {
  candidates: ConsumableSummary[];
}) {
  return (
    <section aria-labelledby="shopping-candidates-title" className="home-section shopping-candidates">
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
            <span className={`stock-status-badge stock-status-${candidate.stockStatus}`}>
              {statusLabel(candidate.stockStatus)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

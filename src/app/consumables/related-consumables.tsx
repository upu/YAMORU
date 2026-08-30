import Link from "next/link";

import type { ConsumableSummary } from "../../lib/d1/consumables";

export function RelatedConsumablesSection({
  addHref,
  consumables,
}: {
  addHref?: string;
  consumables: ConsumableSummary[];
}) {
  return (
    <section aria-labelledby="related-consumables-title" className="detail-card">
      <div className="detail-section-heading">
        <div>
          <p className="detail-kicker">CONSUMABLES</p>
          <h2 id="related-consumables-title">関連する消耗品</h2>
        </div>
        {addHref === undefined ? null : (
          <Link className="ledger-primary-link" href={addHref}>消耗品を追加</Link>
        )}
      </div>
      {consumables.length === 0 ? (
        <p className="ledger-empty">関連する消耗品はありません。</p>
      ) : (
        <ul className="ledger-list">
          {consumables.map((consumable) => (
            <li key={consumable.id}>
              <Link href={`/consumables/${encodeURIComponent(consumable.id)}`}>
                {consumable.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

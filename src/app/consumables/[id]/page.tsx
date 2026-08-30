import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "../../../lib/auth/current-user";
import { getConsumable, type ConsumableDetail } from "../../../lib/d1/consumables";
import { getD1Context } from "../../../lib/d1/context";
import { EditIcon } from "../../edit-icon";
import { isSafeExternalUrl } from "../../managed-items/model";
import { StockStatusControl } from "../stock-status-control";

export type ConsumableDetailData = ConsumableDetail;

function ConsumableRecord({
  consumable,
}: {
  consumable: ConsumableDetailData;
}) {
  const safeExternalUrl = consumable.externalUrl !== null
    && isSafeExternalUrl(consumable.externalUrl)
    ? consumable.externalUrl
    : null;
  return (
    <section aria-labelledby="consumable-record-title" className="detail-card">
          <div className="detail-section-heading">
            <div>
              <p className="detail-kicker">RECORD</p>
              <h2 id="consumable-record-title">消耗品の記録</h2>
            </div>
            <Link
              aria-label="消耗品を編集"
              className="icon-link"
              href={`/consumables/${encodeURIComponent(consumable.id)}/edit`}
            >
              <EditIcon />
            </Link>
          </div>
          <dl className="managed-item-record-list">
            {consumable.productCode === null ? null : (
              <div><dt>型番・品番</dt><dd>{consumable.productCode}</dd></div>
            )}
            {safeExternalUrl === null ? null : (
              <div>
                <dt>外部リンク</dt>
                <dd>
                  <a href={safeExternalUrl} rel="noopener noreferrer" target="_blank">
                    外部リンクを開く<span aria-hidden="true"> ↗</span>
                  </a>
                </dd>
              </div>
            )}
            {consumable.note === null ? null : (
              <div><dt>メモ</dt><dd>{consumable.note}</dd></div>
            )}
          </dl>
    </section>
  );
}

function ConsumableRelations({ consumable }: { consumable: ConsumableDetailData }) {
  return (
    <>
      <section aria-labelledby="consumable-managed-items-title" className="detail-card">
          <p className="detail-kicker">MANAGED ITEMS</p>
          <h2 id="consumable-managed-items-title">関連する管理対象</h2>
          {consumable.managedItems.length === 0 ? (
            <p className="ledger-empty">関連する管理対象はありません。</p>
          ) : (
            <ul className="ledger-list">
              {consumable.managedItems.map((item) => (
                <li key={item.id}>
                  <Link href={`/managed-items/${encodeURIComponent(item.id)}`}>{item.name}</Link>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section aria-labelledby="consumable-task-rules-title" className="detail-card">
          <p className="detail-kicker">TODOS</p>
          <h2 id="consumable-task-rules-title">関連するTodo</h2>
          {consumable.taskRules.length === 0 ? (
            <p className="ledger-empty">関連するTodoはありません。</p>
          ) : (
            <ul className="ledger-list">
              {consumable.taskRules.map((rule) => (
                <li key={rule.id}>
                  <span>{rule.title}</span>
                  {rule.managedItemName === null ? null : (
                    <span className="input-help">{rule.managedItemName}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
      </section>
    </>
  );
}

export function ConsumableDetailContent({
  consumable,
}: {
  consumable: ConsumableDetailData;
}) {
  return (
    <main className="detail-page">
      <nav aria-label="ページ移動" className="back-nav">
        <Link href="/consumables">← 消耗品一覧へ戻る</Link>
      </nav>
      <header className="detail-hero">
        <p className="detail-kicker">CONSUMABLE</p>
        <h1>{consumable.name}</h1>
      </header>

      <div className="ledger-grid">
        <StockStatusControl consumableId={consumable.id} stockStatus={consumable.stockStatus} />
        <ConsumableRecord consumable={consumable} />
        <ConsumableRelations consumable={consumable} />
      </div>
    </main>
  );
}

export default async function ConsumableDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { db, session } = await getD1Context(user);
  const consumable = await getConsumable(db, session, id);
  if (consumable === null) notFound();
  return <ConsumableDetailContent consumable={consumable} />;
}

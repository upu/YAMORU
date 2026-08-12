import Link from "next/link";

import { CAT_WATER_FOUNTAIN } from "./sample-data";

function ActivityHistory() {
  return (
    <section aria-labelledby="history-title" className="detail-card history-card">
      <div className="detail-section-heading">
        <div>
          <p className="detail-kicker">HISTORY</p>
          <h2 id="history-title">最近の実施履歴</h2>
        </div>
        <span
          className="count"
          aria-label={`${String(CAT_WATER_FOUNTAIN.history.length)}件`}
        >
          {CAT_WATER_FOUNTAIN.history.length}
        </span>
      </div>
      <ol className="history-list">
        {CAT_WATER_FOUNTAIN.history.map((activity) => (
          <li key={activity.dateTime}>
            <span className="history-dot" aria-hidden="true" />
            <div>
              <time dateTime={activity.dateTime}>{activity.date}</time>
              <p>{activity.member}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RelatedTodo() {
  return (
    <section aria-labelledby="todo-title" className="detail-card todo-card">
      <p className="detail-kicker">NEXT</p>
      <div className="detail-section-heading">
        <h2 id="todo-title">関連するTodo</h2>
        <span className="tone-label tone-urgent">{CAT_WATER_FOUNTAIN.task.status}</span>
      </div>
      <h3>{CAT_WATER_FOUNTAIN.task.name}</h3>
      <p className="due-date">{CAT_WATER_FOUNTAIN.nextDueDate}</p>
      <p className="detail-note">{CAT_WATER_FOUNTAIN.task.cadence}</p>
    </section>
  );
}

export default function ManagedItemDetail() {
  const item = CAT_WATER_FOUNTAIN;

  return (
    <main className="detail-page">
      <nav aria-label="パンくず" className="back-nav">
        <Link href="/">← ホームへ戻る</Link>
      </nav>

      <header className="detail-hero">
        <p className="detail-kicker">MANAGED ITEM</p>
        <div className="detail-title-row">
          <h1>{item.name}</h1>
          <span className="kind-badge">{item.kind}</span>
        </div>
        <p>フィルター交換の予定と、家族の実施履歴をまとめて確認できます。</p>
      </header>

      <section aria-labelledby="last-activity-title" className="last-activity">
        <p className="detail-kicker">LAST ACTIVITY</p>
        <h2 id="last-activity-title">最後のフィルター交換</h2>
        <div className="last-activity-values">
          <div><span>いつ</span><strong><time dateTime={item.lastActivity.dateTime}>{item.lastActivity.date}</time></strong></div>
          <div><span>誰が</span><strong>{item.lastActivity.member}</strong></div>
        </div>
      </section>

      <div className="detail-grid">
        <RelatedTodo />
        <section aria-labelledby="link-title" className="detail-card link-card">
          <p className="detail-kicker">REFERENCE</p>
          <h2 id="link-title">商品情報</h2>
          <p className="sample-label">安全なサンプルリンク</p>
          <a href={item.externalLink.url} rel="noreferrer" target="_blank">
            {item.externalLink.label}<span aria-hidden="true"> ↗</span>
          </a>
        </section>
      </div>

      <ActivityHistory />
    </main>
  );
}

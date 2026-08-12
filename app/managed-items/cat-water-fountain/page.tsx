"use client";

import Link from "next/link";

import { useDemoState } from "../../demo-state";
import {
  describeMaintenanceSchedule,
  getMaintenanceDisplayState,
  MAINTENANCE_DISPLAY_COPY,
} from "../../task-schedule";
import { type Activity, CAT_WATER_FOUNTAIN } from "./sample-data";

function ActivityHistory({ history }: { history: Activity[] }) {
  return (
    <section aria-labelledby="history-title" className="detail-card history-card">
      <div className="detail-section-heading">
        <div>
          <p className="detail-kicker">HISTORY</p>
          <h2 id="history-title">最近の実施履歴</h2>
        </div>
        <span
          className="count"
          aria-label={`${String(history.length)}件`}
        >
          {history.length}
        </span>
      </div>
      <ol className="history-list">
        {history.map((activity) => (
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

function RelatedTodo({
  dueAt,
  scheduledFor,
}: {
  dueAt: Date;
  scheduledFor: Date;
}) {
  const maintenanceWindow = { scheduledFor, dueAt };
  const state = getMaintenanceDisplayState(maintenanceWindow, new Date());
  const copy = MAINTENANCE_DISPLAY_COPY[state];

  return (
    <section aria-labelledby="todo-title" className="detail-card todo-card">
      <p className="detail-kicker">NEXT</p>
      <div className="detail-section-heading">
        <h2 id="todo-title">関連するTodo</h2>
        <span className={`tone-label tone-${copy.tone}`}>{copy.badge}</span>
      </div>
      <h3>{CAT_WATER_FOUNTAIN.task.name}</h3>
      <p className={`due-date due-date-${copy.tone}`}>
        {describeMaintenanceSchedule(state, maintenanceWindow)}
      </p>
      <p className="detail-note">{CAT_WATER_FOUNTAIN.task.cadence}</p>
    </section>
  );
}

export default function ManagedItemDetail() {
  const item = CAT_WATER_FOUNTAIN;
  const { dueAt, history, lastActivity, scheduledFor } = useDemoState();

  return (
    <main className="detail-page">
      <nav aria-label="ページ移動" className="back-nav">
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
          <div><span>いつ</span><strong><time dateTime={lastActivity.dateTime}>{lastActivity.date}</time></strong></div>
          <div><span>誰が</span><strong>{lastActivity.member}</strong></div>
        </div>
      </section>

      <div className="detail-grid">
        <RelatedTodo dueAt={dueAt} scheduledFor={scheduledFor} />
        <section aria-labelledby="link-title" className="detail-card link-card">
          <p className="detail-kicker">REFERENCE</p>
          <h2 id="link-title">商品情報</h2>
          <p className="sample-label">安全なサンプルリンク</p>
          <a
            href={item.externalLink.url}
            rel="noopener noreferrer"
            target="_blank"
          >
            {item.externalLink.label}<span aria-hidden="true"> ↗</span>
          </a>
        </section>
      </div>

      <ActivityHistory history={history} />
    </main>
  );
}

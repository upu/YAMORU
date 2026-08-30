// ManagedItem詳細の各セクション(#280)。関連するTodo、この管理対象の記録、
// 直近の実施、見出し。データの組み立てはdetail-todos.tsが行う。

import Link from "next/link";
import type { ReactNode } from "react";

import type { HouseholdMemberOption } from "../../../lib/d1/profiles";
import { ClassificationBadges } from "../classification-badges";
import { EditIcon } from "../../edit-icon";
import { startedOnLabel } from "../model";
import { formatStartedOn } from "../started-on";
import { formatTokyoDate } from "../../time-zone";
import { AssigneePanel } from "./assignee-panel";
import { CompleteTodoPanel } from "./complete-todo-panel";
import { PostponePanel } from "./postpone-panel";
import { SchedulePanel } from "./schedule-panel";
import {
  RECURRENCE_LABELS,
  type ExternalLinkData,
  PendingTodoData,
  RecentCompletionData,
} from "./detail-todos";

export function PendingTodoActions({
  actorName,
  currentUserId,
  managedItemId,
  members,
  todo,
}: {
  actorName: string;
  currentUserId: string;
  managedItemId: string;
  members: HouseholdMemberOption[];
  todo: PendingTodoData;
}) {
  return (
    <>
      <AssigneePanel
        assigneeUserId={todo.assigneeUserId}
        managedItemId={managedItemId}
        members={members}
        occurrenceId={todo.id}
        taskTitle={todo.title}
      />
      <CompleteTodoPanel
        actorName={actorName}
        currentUserId={currentUserId}
        managedItemId={managedItemId}
        members={members}
        occurrenceId={todo.id}
        taskTitle={todo.title}
      />
      {todo.recurrenceBasis === "once" ? (
        <SchedulePanel
          managedItemId={managedItemId}
          occurrenceId={todo.id}
          scheduledFor={todo.scheduledFor}
          taskTitle={todo.title}
        />
      ) : null}
      {todo.scheduledFor === null ? null : (
        <PostponePanel
          managedItemId={managedItemId}
          occurrenceId={todo.id}
          taskTitle={todo.title}
        />
      )}
    </>
  );
}

// Issue #240: 「現在のTodo」(確認)と「関連するTodoを追加」(追加)を一つの
// 領域へ整理する(issue本文の設計メモの案1)。確認対象と追加対象の関係が
// 同じ領域から分かるようにし、専用の登録ページへ管理対象を引き継ぐ導線は
// 維持する。
export function RelatedTodoSection({
  actorName,
  currentUserId,
  managedItemId,
  members,
  todos,
}: {
  actorName: string;
  currentUserId: string;
  managedItemId: string;
  members: HouseholdMemberOption[];
  todos: PendingTodoData[];
}) {
  return (
    <section aria-labelledby="related-todos-title" className="detail-card">
      <div className="detail-section-heading">
        <div>
          <p className="detail-kicker">TODO</p>
          <h2 id="related-todos-title">関連するTodo</h2>
        </div>
        <Link
          className="ledger-primary-link"
          href={`/todos/new?managedItemId=${encodeURIComponent(managedItemId)}`}
        >
          Todoを追加
        </Link>
      </div>
      {todos.length === 0 ? (
        <p className="ledger-empty">現在の未完了Todoはありません。</p>
      ) : (
        <ul className="maintenance-todo-list">
          {todos.map((todo) => (
            <li key={todo.id}>
              <div className="task-title-row">
                <strong>
                  <Link href={`/todos/${encodeURIComponent(todo.id)}`}>{todo.title}</Link>
                </strong>
                <span className={`tone-label tone-${todo.tone}`}>{todo.badge}</span>
              </div>
              <span className="input-help">
                {RECURRENCE_LABELS[todo.recurrenceBasis]}
              </span>
              <span>{todo.meta}</span>
              <PendingTodoActions
                actorName={actorName}
                currentUserId={currentUserId}
                managedItemId={managedItemId}
                members={members}
                todo={todo}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Issue #240: 独立したLAST ACTIVITYを廃止した代わりに、最新行(先頭)から
// 「いつ・誰が」を確認できるようにする。訂正済みの実施日時・実施者
// (YDR-026)、完了取消済みを除く現在有効な完了(selectActiveCompletionLogs)
// は、既にbuildRecentCompletionsが解決済みの値を使う。
export function RecentCompletionSection({
  completions,
}: {
  completions: RecentCompletionData[];
}) {
  return (
    <section aria-labelledby="recent-completions-title" className="detail-card">
      <p className="detail-kicker">RECENT ACTIVITY</p>
      <h2 id="recent-completions-title">直近の完了</h2>
      {completions.length === 0 ? (
        <p className="ledger-empty">まだ完了の記録はありません。</p>
      ) : (
        <ul className="maintenance-todo-list">
          {completions.map((completion) => (
            <li key={completion.id}>
              {/* Issue #206: 一覧は確認専用とし、Todo名から完了済み詳細へ移動する。 */}
              <strong>
                <Link href={`/todos/${completion.id}`}>{completion.title}</Link>
              </strong>
              <span>
                {formatTokyoDate(completion.occurredAt)}に完了・{completion.performerName}が実施
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ExternalLinksValue({ links }: { links: ExternalLinkData[] }) {
  return (
    <ul className="external-link-list">
      {links.map((link) => (
        <li key={link.id}>
          <a href={link.url} rel="noopener noreferrer" target="_blank">
            外部リンクを開く: {link.url}
            <span aria-hidden="true"> ↗</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

// Issue #42, #239: 任意の記録は、残した項目だけを名称と値の対として表示する。
// Issue #240: 外部リンクもこの一覧の一項目として統合し(安全なURLだけを
// 受け取る)、記録が一つもなくても見出しと編集導線(鉛筆アイコン)は常に
// 表示する。「管理対象を編集」は名前・分類の変更もできるため、読み上げ名を
// 「記録を編集」に限定しない。
export function ManagedItemRecordSection({
  kindCode,
  managedItemId,
  note,
  productInfo,
  safeLinks,
  startedOn,
}: {
  kindCode: string;
  managedItemId: string;
  note: string | null;
  productInfo: string | null;
  safeLinks: ExternalLinkData[];
  startedOn: string | null;
}) {
  const records: { label: string; value: ReactNode }[] = [];
  if (productInfo !== null) {
    records.push({ label: "メーカー・商品名など", value: productInfo });
  }
  if (startedOn !== null) {
    records.push({ label: startedOnLabel(kindCode), value: formatStartedOn(startedOn) });
  }
  if (safeLinks.length > 0) {
    records.push({ label: "外部リンク", value: <ExternalLinksValue links={safeLinks} /> });
  }
  if (note !== null) records.push({ label: "メモ", value: note });

  return (
    <section aria-labelledby="managed-item-record-title" className="detail-card">
      <div className="detail-section-heading">
        <div>
          <p className="detail-kicker">RECORD</p>
          <h2 id="managed-item-record-title">この管理対象の記録</h2>
        </div>
        <Link
          aria-label="管理対象を編集"
          className="icon-link"
          href={`/managed-items/${encodeURIComponent(managedItemId)}/edit`}
        >
          <EditIcon />
        </Link>
      </div>
      {records.length === 0 ? null : (
        <dl className="managed-item-record-list">
          {records.map((record) => (
            <div key={record.label}>
              <dt>{record.label}</dt>
              <dd>{record.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

// Issue #240: 画面内容から分かる説明文と、文字の「編集」リンクを外す。
// 編集導線はRECORD見出し横の鉛筆アイコンへ集約する。
export function ManagedItemHeader({
  itemTypeLabel,
  kindLabel,
  name,
}: {
  itemTypeLabel: string | null;
  kindLabel: string;
  name: string;
}) {
  return (
    <header className="detail-hero">
      <p className="detail-kicker">MANAGED ITEM</p>
      <div className="detail-title-row">
        <h1>{name}</h1>
        <ClassificationBadges itemTypeLabel={itemTypeLabel} kindLabel={kindLabel} />
      </div>
    </header>
  );
}

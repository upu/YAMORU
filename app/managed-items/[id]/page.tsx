import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "../../../lib/auth/current-user";
import { createClient } from "../../../lib/supabase/server";
import {
  isSafeExternalUrl,
  MANAGED_ITEM_KIND_LABELS,
  type ManagedItemKind,
  toManagedItemKind,
} from "../model";
import { CompleteTodoPanel } from "./complete-todo-panel";
import { MaintenanceTodoForm } from "./maintenance-todo-form";
import { formatTokyoDate } from "./time-zone";

type ExternalLinkData = { id: string; url: string };
type PendingTodoData = {
  dueAt: string;
  id: string;
  scheduledFor: string;
  title: string;
};
type RecentCompletionData = {
  id: string;
  occurredAt: string;
  title: string;
};

export type ManagedItemDetailData = {
  actorName: string;
  externalLinks: ExternalLinkData[];
  id: string;
  kind: ManagedItemKind;
  name: string;
  pendingTodos: PendingTodoData[];
  recentCompletions: RecentCompletionData[];
};

type TaskOccurrenceRow = {
  activity_logs: { action: string; occurred_at: string }[];
  due_at: string;
  id: string;
  scheduled_for: string;
  status: string;
};
type TaskRuleRow = { task_occurrences: TaskOccurrenceRow[]; title: string };

function buildPendingTodos(taskRules: TaskRuleRow[]): PendingTodoData[] {
  return taskRules
    .flatMap((rule) =>
      rule.task_occurrences
        .filter((occurrence) => occurrence.status === "pending")
        .map((occurrence) => ({
          dueAt: occurrence.due_at,
          id: occurrence.id,
          scheduledFor: occurrence.scheduled_for,
          title: rule.title,
        })),
    )
    .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor));
}

function buildRecentCompletions(
  taskRules: TaskRuleRow[],
): RecentCompletionData[] {
  return taskRules
    .flatMap((rule) => {
      const completions = rule.task_occurrences
        .filter((occurrence) => occurrence.status === "completed")
        .flatMap((occurrence) =>
          occurrence.activity_logs
            .filter((log) => log.action === "completed")
            .map((log) => ({
              id: occurrence.id,
              occurredAt: log.occurred_at,
              title: rule.title,
            })),
        );
      if (completions.length === 0) return [];
      // TaskRuleごとに最新の完了だけを「直近の完了」として表示する。
      return [
        completions.reduce((latest, completion) =>
          completion.occurredAt > latest.occurredAt ? completion : latest,
        ),
      ];
    })
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

function PendingTodoSection({
  actorName,
  managedItemId,
  todos,
}: {
  actorName: string;
  managedItemId: string;
  todos: PendingTodoData[];
}) {
  return (
    <section aria-labelledby="current-todos-title" className="detail-card">
      <p className="detail-kicker">CURRENT TODO</p>
      <h2 id="current-todos-title">現在のTodo</h2>
      {todos.length === 0 ? (
        <p className="ledger-empty">現在の未完了Todoはありません。</p>
      ) : (
        <ul className="maintenance-todo-list">
          {todos.map((todo) => (
            <li key={todo.id}>
              <strong>{todo.title}</strong>
              <span>
                {formatTokyoDate(todo.scheduledFor)}〜
                {formatTokyoDate(todo.dueAt)}
              </span>
              <CompleteTodoPanel
                actorName={actorName}
                managedItemId={managedItemId}
                occurrenceId={todo.id}
                taskTitle={todo.title}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecentCompletionSection({
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
              <strong>{completion.title}</strong>
              <span>{formatTokyoDate(completion.occurredAt)}に完了</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ExternalLinksSection({ links }: { links: ExternalLinkData[] }) {
  return (
    <section aria-labelledby="external-links-title" className="detail-card">
      <p className="detail-kicker">REFERENCES</p>
      <h2 id="external-links-title">外部リンク</h2>
      {links.length === 0 ? (
        <p className="ledger-empty">外部リンクは登録されていません。</p>
      ) : (
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
      )}
    </section>
  );
}

export function ManagedItemDetailContent({
  item,
}: {
  item: ManagedItemDetailData;
}) {
  const safeLinks = item.externalLinks.filter((link) =>
    isSafeExternalUrl(link.url),
  );

  return (
    <main className="detail-page">
      <nav aria-label="ページ移動" className="back-nav">
        <Link href="/managed-items">← 家の台帳へ戻る</Link>
      </nav>

      <header className="detail-hero">
        <p className="detail-kicker">MANAGED ITEM</p>
        <div className="detail-title-row">
          <h1>{item.name}</h1>
          <span className="kind-badge">
            {MANAGED_ITEM_KIND_LABELS[item.kind]}
          </span>
        </div>
        <p>登録した管理対象と、現在のメンテナンスTodoを確認できます。</p>
      </header>

      <div className="ledger-grid managed-item-detail-grid">
        <PendingTodoSection
          actorName={item.actorName}
          managedItemId={item.id}
          todos={item.pendingTodos}
        />

        <section aria-labelledby="register-todo-title" className="detail-card">
          <p className="detail-kicker">ADD TODO</p>
          <h2 id="register-todo-title">メンテナンスTodoを登録</h2>
          <p className="detail-note">
            完了した日から次回の目安を計算するTodoを登録します。
          </p>
          <MaintenanceTodoForm managedItemId={item.id} />
        </section>

        <RecentCompletionSection completions={item.recentCompletions} />

        <ExternalLinksSection links={safeLinks} />
      </div>
    </main>
  );
}

const FALLBACK_ACTOR_NAME = "あなた";

async function loadActorName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("nickname")
    .eq("user_id", userId)
    .maybeSingle();

  if (error !== null || data === null) return FALLBACK_ACTOR_NAME;
  return data.nickname;
}

export default async function RegisteredManagedItemDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const supabase = await createClient();
  const [{ data, error }, actorName] = await Promise.all([
    supabase
      .from("managed_items")
      .select(
        "id, name, kind, external_links(id, url), task_rules(id, title, task_occurrences(id, status, scheduled_for, due_at, activity_logs!activity_logs_occurrence_household_fkey(action, occurred_at)))",
      )
      .eq("id", id)
      .maybeSingle(),
    loadActorName(supabase, user.id),
  ]);

  if (error !== null) {
    throw new Error("管理対象を取得できませんでした。");
  }

  if (data === null) notFound();

  const pendingTodos = buildPendingTodos(data.task_rules);
  const recentCompletions = buildRecentCompletions(data.task_rules);

  return (
    <ManagedItemDetailContent
      item={{
        actorName,
        externalLinks: data.external_links,
        id: data.id,
        kind: toManagedItemKind(data.kind),
        name: data.name,
        pendingTodos,
        recentCompletions,
      }}
    />
  );
}

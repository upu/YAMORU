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
import { MaintenanceTodoForm } from "./maintenance-todo-form";
import { formatTokyoDate } from "./time-zone";

type ExternalLinkData = { id: string; url: string };
type PendingTodoData = {
  dueAt: string;
  id: string;
  scheduledFor: string;
  title: string;
};

export type ManagedItemDetailData = {
  externalLinks: ExternalLinkData[];
  id: string;
  kind: ManagedItemKind;
  name: string;
  pendingTodos: PendingTodoData[];
};

function PendingTodoSection({ todos }: { todos: PendingTodoData[] }) {
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
        <PendingTodoSection todos={item.pendingTodos} />

        <section aria-labelledby="register-todo-title" className="detail-card">
          <p className="detail-kicker">ADD TODO</p>
          <h2 id="register-todo-title">メンテナンスTodoを登録</h2>
          <p className="detail-note">
            完了した日から次回の目安を計算するTodoを登録します。
          </p>
          <MaintenanceTodoForm managedItemId={item.id} />
        </section>

        <ExternalLinksSection links={safeLinks} />
      </div>
    </main>
  );
}

export default async function RegisteredManagedItemDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("managed_items")
    .select(
      "id, name, kind, external_links(id, url), task_rules(id, title, task_occurrences(id, status, scheduled_for, due_at))",
    )
    .eq("id", id)
    .maybeSingle();

  if (error !== null) {
    throw new Error("管理対象を取得できませんでした。");
  }

  if (data === null) notFound();

  const pendingTodos = data.task_rules
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

  return (
    <ManagedItemDetailContent
      item={{
        externalLinks: data.external_links,
        id: data.id,
        kind: toManagedItemKind(data.kind),
        name: data.name,
        pendingTodos,
      }}
    />
  );
}

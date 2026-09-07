import Link from "next/link";
import type { ReactNode } from "react";

import type {
  CrossSearchConsumable,
  CrossSearchManagedItem,
  CrossSearchResults,
  CrossSearchTodo,
} from "../../lib/d1/cross-search";
import { CROSS_SEARCH_LIMIT } from "../../lib/d1/cross-search";
import { StockStatusBadge } from "../consumables/stock-status";
import { formatTokyoShortMonthDay } from "../time-zone";

// Issue #350 / YDR-042: 結果は種類ごとのセクションへ分け、順序を「Todo」
// 「備品」「サービス・契約」「消耗品」とする(台帳の入口の並び #291 と揃える)。
// 一致が0件の種類はセクションごと出さない。

function SearchResultSection({
  children,
  count,
  id,
  title,
}: {
  children: ReactNode;
  count: number;
  id: string;
  title: string;
}) {
  return (
    <section aria-labelledby={id} className="detail-card">
      <div className="search-section-heading">
        <h2 id={id}>{title}</h2>
        <span aria-label={`${String(count)}件`} className="count">{count}</span>
      </div>
      <ul className="ledger-list">{children}</ul>
    </section>
  );
}

// 上限に達した種類だけへ出す案内。総件数は数えていないため「あと何件」は
// 言わず、いま並べている件数と絞り込み方だけを伝える。
function MoreResultsNote({ hasMore, unit }: { hasMore: boolean; unit: string }) {
  if (!hasMore) return null;
  return (
    <p className="search-more-note">
      {unit}の一致が多いため、先頭{CROSS_SEARCH_LIMIT}件を表示しています。語を足すと絞り込めます。
    </p>
  );
}

// Todoの補助情報。予定日と期限が異なる(メンテナンスの推奨期間)ときは範囲で
// 示す。行はTodo詳細への導線なので、状態語(期限切れ・そろそろ)まではここで
// 判定せず、日付だけを出す(Todo一覧の行 #243 と同じ考え方)。
function describeTodoSchedule(todo: CrossSearchTodo): string {
  if (todo.scheduledFor === null) return "予定日未定";
  const from = formatTokyoShortMonthDay(todo.scheduledFor);
  if (todo.dueAt === null || todo.dueAt === todo.scheduledFor) return from;
  return `${from}〜${formatTokyoShortMonthDay(todo.dueAt)}`;
}

function TodoResults({ todos }: { todos: CrossSearchResults["todos"] }) {
  if (todos.items.length === 0) return null;
  return (
    <>
      <SearchResultSection count={todos.items.length} id="search-todos-title" title="Todo">
        {todos.items.map((todo) => (
          <li key={todo.id}>
            <Link href={`/todos/${encodeURIComponent(todo.id)}`}>{todo.title}</Link>
            <span className="search-result-meta">
              <span className="sr-only">予定: </span>
              {describeTodoSchedule(todo)}
            </span>
          </li>
        ))}
      </SearchResultSection>
      <MoreResultsNote hasMore={todos.hasMore} unit="Todo" />
    </>
  );
}

// 大分類はデータ(managed_item_kinds)で決まるため、備品・サービス・契約を
// 決め打ちで並べず、結果に出た大分類ごとにまとめる。YDR-036で選べなくなった
// 過去の大分類(その他など)の管理対象も、名前で探せば自分の見出しの下に出る。
// 表示順は台帳の入口と同じ備品→サービス・契約とし、それ以外は後ろへ置く。
const MANAGED_ITEM_KIND_ORDER = ["asset", "service"];

function managedItemKindGroups(
  items: CrossSearchManagedItem[],
): { items: CrossSearchManagedItem[]; kindCode: string; kindLabel: string }[] {
  const groups = new Map<string, { items: CrossSearchManagedItem[]; kindCode: string; kindLabel: string }>();
  for (const item of items) {
    const group = groups.get(item.kindCode)
      ?? { items: [], kindCode: item.kindCode, kindLabel: item.kindLabel };
    group.items.push(item);
    groups.set(item.kindCode, group);
  }
  return [...groups.values()].sort((left, right) => {
    const leftOrder = MANAGED_ITEM_KIND_ORDER.indexOf(left.kindCode);
    const rightOrder = MANAGED_ITEM_KIND_ORDER.indexOf(right.kindCode);
    return (leftOrder === -1 ? MANAGED_ITEM_KIND_ORDER.length : leftOrder)
      - (rightOrder === -1 ? MANAGED_ITEM_KIND_ORDER.length : rightOrder);
  });
}

function ManagedItemResults({
  managedItems,
}: {
  managedItems: CrossSearchResults["managedItems"];
}) {
  if (managedItems.items.length === 0) return null;
  return (
    <>
      {managedItemKindGroups(managedItems.items).map((group) => (
        <SearchResultSection
          count={group.items.length}
          id={`search-managed-items-${group.kindCode}-title`}
          key={group.kindCode}
          title={group.kindLabel}
        >
          {group.items.map((item) => (
            <li key={item.id}>
              <Link href={`/managed-items/${encodeURIComponent(item.id)}`}>{item.name}</Link>
              {item.itemTypeLabel === null ? null : (
                <span className="search-result-meta">
                  <span className="sr-only">詳しい種類: </span>
                  {item.itemTypeLabel}
                </span>
              )}
            </li>
          ))}
        </SearchResultSection>
      ))}
      {/* 上限は大分類ごとではなく管理対象の取得全体にかかるため、案内も
          大分類のセクションをまたいで1回だけ出す。 */}
      <MoreResultsNote hasMore={managedItems.hasMore} unit="台帳の管理対象" />
    </>
  );
}

// 在庫状態は検索条件ではなく結果の補助情報として出す(YDR-042)。「卵」を
// 探した利用者が、詳細へ入る前に「ある/少ない/ない」を把握できる。
function ConsumableResults({
  consumables,
}: {
  consumables: CrossSearchResults["consumables"];
}) {
  if (consumables.items.length === 0) return null;
  return (
    <>
      <SearchResultSection
        count={consumables.items.length}
        id="search-consumables-title"
        title="消耗品"
      >
        {consumables.items.map((consumable: CrossSearchConsumable) => (
          <li key={consumable.id}>
            <Link href={`/consumables/${encodeURIComponent(consumable.id)}`}>
              {consumable.name}
            </Link>
            <span className="search-result-meta">
              <span className="sr-only">在庫: </span>
              <StockStatusBadge stockStatus={consumable.stockStatus} />
            </span>
          </li>
        ))}
      </SearchResultSection>
      <MoreResultsNote hasMore={consumables.hasMore} unit="消耗品" />
    </>
  );
}

export function searchResultCount(results: CrossSearchResults): number {
  return results.todos.items.length
    + results.managedItems.items.length
    + results.consumables.items.length;
}

// 0件のときは「登録されていない」と決めつけず、検索語と各一覧の入口を示す。
function SearchEmptyState({ q }: { q: string }) {
  return (
    <section aria-labelledby="search-empty-title" className="detail-card">
      <h2 id="search-empty-title">「{q}」に一致する対象はありません</h2>
      <p className="ledger-empty">
        名前の一部だけでも探せます。表記が違うかもしれない場合は、一覧から探せます。
      </p>
      <ul className="ledger-list">
        <li><Link href="/todos">Todo一覧を開く</Link></li>
        <li><Link href="/managed-items?kind=asset">台帳（備品）を開く</Link></li>
        <li><Link href="/consumables">台帳（消耗品）を開く</Link></li>
      </ul>
    </section>
  );
}

export function SearchResults({
  q,
  results,
}: {
  q: string;
  results: CrossSearchResults;
}) {
  if (searchResultCount(results) === 0) return <SearchEmptyState q={q} />;
  return (
    <>
      <TodoResults todos={results.todos} />
      <ManagedItemResults managedItems={results.managedItems} />
      <ConsumableResults consumables={results.consumables} />
    </>
  );
}

import Link from "next/link";

import { requireUser } from "../../lib/auth/current-user";
import { getD1Context } from "../../lib/d1/context";
import { loadAccountState } from "../../lib/d1/households";
import {
  listManagedItemClassificationOptions,
  listManagedItems,
  type ManagedItemClassificationOptions,
} from "../../lib/d1/managed-items";
import { FloatingAddButton } from "../floating-add-button";
import { ClassificationBadges } from "./classification-badges";

export type ManagedItemSummary = {
  id: string;
  itemTypeLabel: string | null;
  kindLabel: string;
  name: string;
};

type HouseholdSummary = { id: string; name: string };

// Issue #218: 台帳一覧の検索・絞り込み。q(名前)・kind(大分類)・itemType
// (詳しい種類)のクエリーパラメーターをサーバー側の取得条件へ反映する案1を
// 採用する(issue本文の設計メモ)。Todo一覧の状態・担当・検索(#222, #223,
// #225)と同じ「URLだけで状態を復元できる」仕組みで統一でき、共有・
// 再読み込みにも強い。案2(クライアント側絞り込み)は初期実装は簡単だが、
// 件数が増えたときの取得量が気になり、案3の移行判断も増やすため、最初から
// サーバー側(src/lib/d1/managed-items.tsのlistManagedItems)へ統一した。
function parseSearchQuery(value: string | string[] | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function parseCodeParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function buildManagedItemsHref(
  itemType: string | undefined,
  kind: string | undefined,
  q: string | undefined,
): string {
  const params = new URLSearchParams();
  if (kind !== undefined) params.set("kind", kind);
  if (itemType !== undefined) params.set("itemType", itemType);
  if (q !== undefined) params.set("q", q);
  const query = params.toString();
  return query === "" ? "/managed-items" : `/managed-items?${query}`;
}

// 大分類・詳しい種類のコード値を、家族に見せる名前へ解決する。URLの生の値が
// 存在しないコードを指す場合(不正な値・仕様変更で廃止された値)は、条件を
// 説明せず結果(0件になる)だけに任せる。
function resolveClassificationLabel(
  code: string | undefined,
  options: { code: string; label: string }[],
): string | null {
  if (code === undefined) return null;
  return options.find((option) => option.code === code)?.label ?? null;
}

// Issue #218: 適用中の検索語・絞り込みを家族に見せる言葉でまとめる
// (受け入れ基準「適用中の条件と件数が分かり」)。
function describeManagedItemsFilters(
  itemTypeLabel: string | null,
  kindLabel: string | null,
  q: string | undefined,
): string | null {
  const parts: string[] = [];
  if (kindLabel !== null) parts.push(`大分類: ${kindLabel}`);
  if (itemTypeLabel !== null) parts.push(`詳しい種類: ${itemTypeLabel}`);
  if (q !== undefined) parts.push(`検索語: 「${q}」`);
  return parts.length === 0 ? null : parts.join(" ・ ");
}

function ManagedItemsSearchForm({
  classificationOptions,
  itemType,
  kind,
  q,
}: {
  classificationOptions: ManagedItemClassificationOptions;
  itemType: string | undefined;
  kind: string | undefined;
  q: string | undefined;
}) {
  const searchId = "managed-items-search-q";
  const kindId = "managed-items-search-kind";
  const itemTypeId = "managed-items-search-item-type";
  return (
    <form
      action="/managed-items"
      aria-label="台帳を検索・絞り込み"
      className="auth-form ledger-search-form"
      method="get"
    >
      <label className="sr-only" htmlFor={searchId}>管理対象名で検索</label>
      <input
        defaultValue={q ?? ""}
        id={searchId}
        name="q"
        placeholder="名前の一部を入力"
        type="search"
      />

      <label className="sr-only" htmlFor={kindId}>大分類で絞り込み</label>
      <select defaultValue={kind ?? ""} id={kindId} name="kind">
        <option value="">大分類: すべて</option>
        {classificationOptions.kinds.map((option) => (
          <option key={option.code} value={option.code}>{option.label}</option>
        ))}
      </select>

      <label className="sr-only" htmlFor={itemTypeId}>詳しい種類で絞り込み</label>
      <select defaultValue={itemType ?? ""} id={itemTypeId} name="itemType">
        <option value="">詳しい種類: すべて</option>
        {classificationOptions.kinds.map((kindOption) => (
          <optgroup key={kindOption.code} label={kindOption.label}>
            {classificationOptions.itemTypes
              .filter((itemTypeOption) => itemTypeOption.kindCode === kindOption.code)
              .map((itemTypeOption) => (
                <option key={itemTypeOption.code} value={itemTypeOption.code}>
                  {itemTypeOption.label}
                </option>
              ))}
          </optgroup>
        ))}
      </select>

      <button type="submit">絞り込む</button>
    </form>
  );
}

function ManagedItemsFilterSummary({
  filterDescription,
}: {
  filterDescription: string | null;
}) {
  if (filterDescription === null) return null;
  return (
    <p className="ledger-filter-summary">
      {filterDescription}
      {/* Issue #218: 複数条件を一度にまとめて解除できる(受け入れ基準)。 */}
      <Link className="ledger-filter-clear" href={buildManagedItemsHref(undefined, undefined, undefined)}>
        条件をクリア
      </Link>
    </p>
  );
}

// Issue #218: household内に一件も管理対象がない(検索・絞り込み以前の空)のか、
// 条件に一致しないだけ(0件)なのかを区別できる案内にする(受け入れ基準)。
function ManagedItemsEmptyState({
  filterDescription,
}: {
  filterDescription: string | null;
}) {
  if (filterDescription !== null) {
    return (
      <p className="ledger-empty">
        {filterDescription}に一致する管理対象はありません。検索語や絞り込みを変えてお試しください。
      </p>
    );
  }
  return (
    <p className="ledger-empty">
      まだ管理対象はありません。右下の「＋」ボタンから台帳に追加できます。
    </p>
  );
}

function ManagedItemsList({ items }: { items: ManagedItemSummary[] }) {
  return (
    <ul className="ledger-list">
      {items.map((item) => (
        <li key={item.id}>
          <Link href={`/managed-items/${item.id}`}>{item.name}</Link>
          <ClassificationBadges
            itemTypeLabel={item.itemTypeLabel}
            kindLabel={item.kindLabel}
          />
        </li>
      ))}
    </ul>
  );
}

function RegisteredItemsSection({
  classificationOptions,
  items,
  itemType,
  kind,
  q,
}: {
  classificationOptions: ManagedItemClassificationOptions;
  items: ManagedItemSummary[];
  itemType: string | undefined;
  kind: string | undefined;
  q: string | undefined;
}) {
  const itemTypeLabel = resolveClassificationLabel(itemType, classificationOptions.itemTypes);
  const kindLabel = resolveClassificationLabel(kind, classificationOptions.kinds);
  const filterDescription = describeManagedItemsFilters(itemTypeLabel, kindLabel, q);
  return (
    <section aria-labelledby="registered-items-title" className="detail-card">
      {/* Issue #237: ページ名「家の台帳」と意味が重なる「ITEMS」「登録済みの
      管理対象」を画面上の見出しとしては出さない(案1)。一覧領域の意味は
      支援技術向けに残したaria-labelledbyの見出しで伝える。 */}
      <h2 className="sr-only" id="registered-items-title">登録済みの管理対象</h2>
      <div className="ledger-list-heading">
        <span aria-label={`${String(items.length)}件`} className="count">{items.length}</span>
      </div>

      <ManagedItemsSearchForm
        classificationOptions={classificationOptions}
        itemType={itemType}
        kind={kind}
        q={q}
      />
      <ManagedItemsFilterSummary filterDescription={filterDescription} />

      {items.length === 0 ? (
        <ManagedItemsEmptyState filterDescription={filterDescription} />
      ) : (
        <ManagedItemsList items={items} />
      )}
    </section>
  );
}

function HouseholdRequiredNotice() {
  return (
    <section aria-labelledby="household-required-title" className="detail-card">
      <h2 id="household-required-title">家庭を作成してください</h2>
      <p>台帳は家庭ごとに保存します。先にアカウント画面で家庭を作成してください。</p>
      <Link className="ledger-primary-link" href="/account">
        家庭を作成する
      </Link>
    </section>
  );
}

export function ManagedItemsContent({
  classificationOptions,
  household,
  itemType,
  items,
  kind,
  q,
}: {
  classificationOptions?: ManagedItemClassificationOptions;
  household: HouseholdSummary | null;
  itemType?: string | undefined;
  items: ManagedItemSummary[];
  kind?: string | undefined;
  q?: string | undefined;
}) {
  return (
    <main className="detail-page ledger-page">
      <header className="detail-hero">
        <p className="detail-kicker">HOUSE LEDGER</p>
        <h1>家の台帳</h1>
        <p>家で管理するものをまとめます。</p>
      </header>

      {household === null ? (
        <HouseholdRequiredNotice />
      ) : (
        <div className="ledger-grid">
          <RegisteredItemsSection
            classificationOptions={classificationOptions ?? { itemTypes: [], kinds: [] }}
            items={items}
            itemType={itemType}
            kind={kind}
            q={q}
          />
        </div>
      )}
      {household === null ? null : (
        <FloatingAddButton destination="managed-item" />
      )}
    </main>
  );
}

export default async function ManagedItemsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { db, session } = await getD1Context(user);
  const resolvedSearchParams = await searchParams;
  const q = parseSearchQuery(resolvedSearchParams.q);
  const kind = parseCodeParam(resolvedSearchParams.kind);
  const itemType = parseCodeParam(resolvedSearchParams.itemType);

  const accountState = await loadAccountState(db, session);
  const household: HouseholdSummary | null = accountState.household;
  if (household === null) {
    return <ManagedItemsContent household={null} items={[]} />;
  }

  const [items, classificationOptions] = await Promise.all([
    listManagedItems(db, session, { itemTypeCode: itemType, kindCode: kind, search: q }),
    listManagedItemClassificationOptions(db),
  ]);

  return (
    <ManagedItemsContent
      classificationOptions={classificationOptions}
      household={household}
      itemType={itemType}
      items={items}
      kind={kind}
      q={q}
    />
  );
}

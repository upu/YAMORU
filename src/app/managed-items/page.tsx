import Link from "next/link";

import { requireUser } from "../../lib/auth/current-user";
import { getD1Context } from "../../lib/d1/context";
import { loadAccountState } from "../../lib/d1/households";
import {
  listHouseholdCustomItemTypes,
  listManagedItemClassificationOptions,
  listManagedItems,
  type ManagedItemClassificationOptions,
  type ManagedItemCustomTypeOption,
} from "../../lib/d1/managed-items";
import { FloatingAddButton } from "../floating-add-button";
import { ClassificationBadges } from "./classification-badges";
import type { ManagedItemTypeGroup } from "./item-type-picker";
import { ManagedItemsSearchForm } from "./managed-items-search-form";
import { normalizeItemTypeText } from "./model";
import { buildManagedItemsHref } from "./search-href";

export type ManagedItemSummary = {
  id: string;
  itemTypeLabel: string | null;
  kindLabel: string;
  name: string;
};

type HouseholdSummary = { id: string; name: string };

// Issue #238: 詳しい種類の絞り込みURLは、プリセットのコード値(itemType=
// appliance)と自由入力の表記(itemType=custom:虫かご)を単一のクエリー
// パラメーターの中で「種別付き値」として判別する(issue本文の設計メモ、
// 別パラメーター案との比較で、Issue #218からのブックマーク・共有URLの
// プリセット絞り込みをそのまま動かせる案を採った)。
const CUSTOM_ITEM_TYPE_PREFIX = "custom:";

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

function parseRawParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

// Issue #238: itemTypeの生の値をプリセットコードと自由入力値へ分ける。
// "custom:"で始まらなければ従来どおりプリセットコードとして扱う(Issue #218の
// URL形式と互換)。"custom:"の後ろが空(前後の空白だけ)なら、絞り込みなしと
// 同じ扱いにする。
function parseItemTypeParam(raw: string): {
  customItemType?: string;
  itemTypeCode?: string;
} {
  if (raw === "") return {};
  if (raw.startsWith(CUSTOM_ITEM_TYPE_PREFIX)) {
    const customItemType = raw.slice(CUSTOM_ITEM_TYPE_PREFIX.length).trim();
    return customItemType === "" ? {} : { customItemType };
  }
  return { itemTypeCode: raw };
}

// 大分類のコード値を、家族に見せる名前へ解決する。URLの生の値が存在しない
// コードを指す場合(不正な値・仕様変更で廃止された値)は、条件を説明せず
// 結果(0件になる)だけに任せる。
function resolveClassificationLabel(
  code: string | undefined,
  options: { code: string; label: string }[],
): string | null {
  if (code === undefined) return null;
  return options.find((option) => option.code === code)?.label ?? null;
}

// Issue #238: 詳しい種類の適用中ラベルは、プリセットならグローバルな候補
// (classificationOptions.itemTypes)、自由入力なら家庭内で実際に使われている
// 候補(customItemTypeOptions)から解決する。どちらの候補にも見つからない
// 値は(不正な値・他家庭だけの自由入力値)、resolveClassificationLabelと同じく
// 説明を出さない。
function resolveItemTypeLabel(
  itemTypeCode: string | undefined,
  customItemType: string | undefined,
  classificationOptions: ManagedItemClassificationOptions,
  customItemTypeOptions: ManagedItemCustomTypeOption[],
): string | null {
  if (itemTypeCode !== undefined) {
    return resolveClassificationLabel(itemTypeCode, classificationOptions.itemTypes);
  }
  if (customItemType !== undefined) {
    const normalized = normalizeItemTypeText(customItemType);
    return customItemTypeOptions
      .find((option) => normalizeItemTypeText(option.label) === normalized)?.label ?? null;
  }
  return null;
}

// Issue #238: 詳しい種類の候補(ManagedItemTypePicker)を、大分類ごとにプリセット
// →自由入力の順で組み立てる。候補が1件もない大分類は表示しない。
function buildItemTypeGroups(
  classificationOptions: ManagedItemClassificationOptions,
  customItemTypeOptions: ManagedItemCustomTypeOption[],
): ManagedItemTypeGroup[] {
  return classificationOptions.kinds
    .map((kindOption) => ({
      kindCode: kindOption.code,
      kindLabel: kindOption.label,
      options: [
        ...classificationOptions.itemTypes
          .filter((itemType) => itemType.kindCode === kindOption.code)
          .map((itemType) => ({ isCustom: false, label: itemType.label, value: itemType.code })),
        ...customItemTypeOptions
          .filter((custom) => custom.kindCode === kindOption.code)
          .map((custom) => ({
            isCustom: true,
            label: custom.label,
            value: `${CUSTOM_ITEM_TYPE_PREFIX}${custom.label}`,
          })),
      ],
    }))
    .filter((group) => group.options.length > 0);
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

function ManagedItemsFilterSummary({
  filterDescription,
  itemTypeClearHref,
  itemTypeLabel,
}: {
  filterDescription: string | null;
  itemTypeClearHref: string | null;
  itemTypeLabel: string | null;
}) {
  if (filterDescription === null) return null;
  return (
    <p className="ledger-filter-summary">
      {filterDescription}
      {itemTypeLabel === null || itemTypeClearHref === null ? null : (
        <Link
          aria-label={`詳しい種類「${itemTypeLabel}」を解除`}
          className="ledger-filter-clear"
          href={itemTypeClearHref}
        >
          詳しい種類を解除
        </Link>
      )}
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
      まだ管理対象はありません。「新しく登録」から台帳に追加できます。
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

// Issue #285: 検索欄へ入力しなくても新規登録の入口が見つかるように、検索・
// 絞り込みより前の行へ登録リンクを置く(右下のフローティングボタンはそのまま
// 維持する)。件数バッジと同じ行に収めるため、モバイルでも一覧確認を押し下げる
// 高さを増やさない。
function LedgerListHeading({ count }: { count: number }) {
  return (
    <div className="ledger-list-heading">
      <Link className="ledger-add-link" href="/managed-items/new">
        <span aria-hidden="true">＋</span>新しく登録
      </Link>
      <span aria-label={`${String(count)}件`} className="count">{count}</span>
    </div>
  );
}

function RegisteredItemsSection({
  classificationOptions,
  customItemType,
  customItemTypeOptions,
  items,
  itemTypeCode,
  itemTypeRaw,
  kind,
  q,
}: {
  classificationOptions: ManagedItemClassificationOptions;
  customItemType: string | undefined;
  customItemTypeOptions: ManagedItemCustomTypeOption[];
  items: ManagedItemSummary[];
  itemTypeCode: string | undefined;
  itemTypeRaw: string;
  kind: string | undefined;
  q: string | undefined;
}) {
  const itemTypeLabel = resolveItemTypeLabel(
    itemTypeCode, customItemType, classificationOptions, customItemTypeOptions,
  );
  const kindLabel = resolveClassificationLabel(kind, classificationOptions.kinds);
  const filterDescription = describeManagedItemsFilters(itemTypeLabel, kindLabel, q);
  const itemTypeGroups = buildItemTypeGroups(classificationOptions, customItemTypeOptions);
  const itemTypeClearHref = itemTypeLabel === null
    ? null
    : buildManagedItemsHref(undefined, kind, q);
  return (
    <section aria-labelledby="registered-items-title" className="detail-card">
      {/* Issue #237: ページ名「家の台帳」と意味が重なる「ITEMS」「登録済みの
      管理対象」を画面上の見出しとしては出さない(案1)。一覧領域の意味は
      支援技術向けに残したaria-labelledbyの見出しで伝える。 */}
      <h2 className="sr-only" id="registered-items-title">登録済みの管理対象</h2>
      <LedgerListHeading count={items.length} />

      <ManagedItemsSearchForm
        itemTypeGroups={itemTypeGroups}
        itemTypeRaw={itemTypeRaw}
        kind={kind}
        kinds={classificationOptions.kinds}
        q={q}
      />
      <ManagedItemsFilterSummary
        filterDescription={filterDescription}
        itemTypeClearHref={itemTypeClearHref}
        itemTypeLabel={itemTypeLabel}
      />

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
  customItemType,
  customItemTypeOptions,
  household,
  itemTypeCode,
  itemTypeRaw,
  items,
  kind,
  q,
}: {
  classificationOptions?: ManagedItemClassificationOptions;
  customItemType?: string | undefined;
  customItemTypeOptions?: ManagedItemCustomTypeOption[];
  household: HouseholdSummary | null;
  itemTypeCode?: string | undefined;
  itemTypeRaw?: string;
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
        {household === null ? null : (
          <Link className="ledger-primary-link" href="/consumables">
            消耗品を見る
          </Link>
        )}
      </header>

      {household === null ? (
        <HouseholdRequiredNotice />
      ) : (
        <div className="ledger-grid">
          <RegisteredItemsSection
            classificationOptions={classificationOptions ?? { itemTypes: [], kinds: [] }}
            customItemType={customItemType}
            customItemTypeOptions={customItemTypeOptions ?? []}
            items={items}
            itemTypeCode={itemTypeCode}
            itemTypeRaw={itemTypeRaw ?? ""}
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
  const { customItemType, itemTypeCode } = parseItemTypeParam(parseRawParam(resolvedSearchParams.itemType));
  // Issue #238: ピッカーへ渡す初期選択値は、URLの生の値そのものではなく
  // parseItemTypeParamが解決した値から組み立て直す。前後の空白などで
  // どの候補にも一致しない生の値を渡すと、「すべて」にも該当候補にも
  // チェックが付かない見た目になるため、絞り込みなし(itemTypeCode・
  // customItemTypeとも未設定)の場合は必ず空文字(「すべて」)へ揃える。
  const itemTypeRaw = itemTypeCode ?? (customItemType === undefined ? "" : `${CUSTOM_ITEM_TYPE_PREFIX}${customItemType}`);

  const accountState = await loadAccountState(db, session);
  const household: HouseholdSummary | null = accountState.household;
  if (household === null) {
    return <ManagedItemsContent household={null} items={[]} />;
  }

  const [items, classificationOptions, customItemTypeOptions] = await Promise.all([
    listManagedItems(db, session, { customItemType, itemTypeCode, kindCode: kind, search: q }),
    listManagedItemClassificationOptions(db),
    listHouseholdCustomItemTypes(db, session),
  ]);

  return (
    <ManagedItemsContent
      classificationOptions={classificationOptions}
      customItemType={customItemType}
      customItemTypeOptions={customItemTypeOptions}
      household={household}
      itemTypeCode={itemTypeCode}
      itemTypeRaw={itemTypeRaw}
      items={items}
      kind={kind}
      q={q}
    />
  );
}

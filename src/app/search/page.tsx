import { requireUser } from "../../lib/auth/current-user";
import { getD1Context } from "../../lib/d1/context";
import { loadAccountState } from "../../lib/d1/households";
import { searchAcrossHousehold, type CrossSearchResults } from "../../lib/d1/cross-search";
import { LedgerHouseholdRequiredNotice } from "../ledger-page-shell";
import { SearchForm } from "./search-form";
import { SearchResults } from "./results";

// Issue #350 / YDR-042: YAMORU全体をまたぐ横断検索の画面。画面内検索
// (Todo一覧・台帳)が「いま開いている一覧を絞り込む」のに対し、この画面は
// 「画面を選ばず名前から対象へ到達する」ためのもので、条件は検索語だけを持つ。
// 入口は下部ナビゲーションの4項目目(mobile-bottom-navigation.tsx)。

function parseSearchQuery(value: string | string[] | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

// 検索語が空のときは0件表示にせず、何を探せるかだけを短く示す。
function SearchGuide() {
  return (
    <section aria-labelledby="search-guide-title" className="detail-card">
      <h2 className="sr-only" id="search-guide-title">検索の使い方</h2>
      <p className="ledger-empty">
        名前を入力すると、Todoと台帳（備品・サービス・契約・消耗品）をまとめて探せます。
        「卵」のように名前の一部でも探せます。
      </p>
    </section>
  );
}

export function SearchContent({
  hasHousehold,
  q,
  results,
}: {
  hasHousehold: boolean;
  q: string | undefined;
  results: CrossSearchResults | null;
}) {
  return (
    <main className="detail-page search-page">
      <header className="detail-hero">
        <p className="detail-kicker">SEARCH</p>
        <h1>検索</h1>
        <p>Todoと台帳をまたいで、名前から対象を探します。</p>
      </header>

      {hasHousehold ? <SearchForm q={q} /> : null}

      <div className="ledger-grid">
        {!hasHousehold ? (
          <LedgerHouseholdRequiredNotice />
        ) : q === undefined || results === null ? (
          <SearchGuide />
        ) : (
          <SearchResults q={q} results={results} />
        )}
      </div>
    </main>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { db, session } = await getD1Context(user);
  const q = parseSearchQuery((await searchParams).q);

  const accountState = await loadAccountState(db, session);
  if (accountState.household === null) {
    return <SearchContent hasHousehold={false} q={q} results={null} />;
  }

  // 検索語が無いときは問い合わせない(searchAcrossHouseholdも全件は返さない)。
  const results = q === undefined ? null : await searchAcrossHousehold(db, session, q);
  return <SearchContent hasHousehold q={q} results={results} />;
}

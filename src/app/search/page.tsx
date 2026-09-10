import { requireUser } from "../../lib/auth/current-user";
import { getD1Context } from "../../lib/d1/context";
import { loadAccountState } from "../../lib/d1/households";
import { searchAcrossHousehold, type CrossSearchResults } from "../../lib/d1/cross-search";
import {
  FALLBACK_SELF_ACTOR_NAME,
  loadActorName,
  loadHouseholdMembers,
  type HouseholdMemberOption,
} from "../../lib/d1/profiles";
import { LedgerHouseholdRequiredNotice } from "../ledger-page-shell";
import { SearchForm } from "./search-form";
import { SearchResults } from "./results";
import styles from "./search-results.module.css";

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
  actorName,
  currentUserId,
  hasHousehold,
  members,
  q,
  results,
}: {
  actorName: string;
  currentUserId: string;
  hasHousehold: boolean;
  members: HouseholdMemberOption[];
  q: string | undefined;
  results: CrossSearchResults | null;
}) {
  return (
    <main className={`detail-page ${styles.page}`}>
      {/* Issue #396: 何を探せるかは、検索語がないときの案内(SearchGuide)が
      同じことを書いている。結果を見ている間は繰り返さない。 */}
      <header className="detail-hero">
        <p className="detail-kicker">SEARCH</p>
        <h1>検索</h1>
      </header>

      {hasHousehold ? <SearchForm q={q} /> : null}

      {/* Issue #396: 分類のまとまりは外側のカードを持たないため、カードどうしの
      間隔(ledger-grid)ではなく、この画面の間隔で並べる。 */}
      <div className={styles.results}>
        {!hasHousehold ? (
          <LedgerHouseholdRequiredNotice />
        ) : q === undefined || results === null ? (
          <SearchGuide />
        ) : (
          <SearchResults
            actorName={actorName}
            currentUserId={currentUserId}
            members={members}
            q={q}
            results={results}
          />
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
    return (
      <SearchContent
        actorName={FALLBACK_SELF_ACTOR_NAME}
        currentUserId={user.id}
        hasHousehold={false}
        members={[]}
        q={q}
        results={null}
      />
    );
  }

  // 検索語が無いときは問い合わせない(searchAcrossHouseholdも全件は返さない)。
  const [actorName, members, results] = await Promise.all([
    loadActorName(db, session, user.id, FALLBACK_SELF_ACTOR_NAME),
    loadHouseholdMembers(db, session),
    q === undefined ? Promise.resolve(null) : searchAcrossHousehold(db, session, q),
  ]);
  return (
    <SearchContent
      actorName={actorName}
      currentUserId={user.id}
      hasHousehold
      members={members}
      q={q}
      results={results}
    />
  );
}

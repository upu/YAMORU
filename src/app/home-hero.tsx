// ホーム上部の見出し・主要導線・件数サマリー。件数サマリーはホーム内の
// 該当セクションへの導線を兼ねる(Issue #360)。遷移先のidはhome-anchors.tsが持つ。
import Link from "next/link";

import {
  HOME_OVERDUE_ANCHOR_ID,
  HOME_SHOPPING_CANDIDATES_ANCHOR_ID,
  HOME_TODO_SECTIONS_ANCHOR_ID,
} from "./home-anchors";
import styles from "./home.module.css";

// Issue #360: 件数が1件以上のときは、ブロック全体をホーム内セクションへの
// タップ領域にする。0件のときは遷移先セクションがホームに出ないため、
// リンクにせず通常表示のままにする。
function HomeSummaryItem({
  anchorId,
  count,
  label,
  linkLabel,
}: {
  anchorId: string;
  count: number;
  label: string;
  linkLabel: string;
}) {
  const content = (
    <>
      <strong>{count}</strong>
      <span>{label}</span>
    </>
  );

  if (count === 0) return <div className={styles.summaryItem}>{content}</div>;

  return (
    <Link
      aria-label={linkLabel}
      className={`${styles.summaryItem} ${styles.summaryLink}`}
      href={`#${anchorId}`}
    >
      {content}
    </Link>
  );
}

export function HomeHero({
  hasHousehold,
  openItemCount,
  overdueItemCount,
  shoppingCandidateCount,
}: {
  hasHousehold: boolean;
  openItemCount: number;
  overdueItemCount: number;
  shoppingCandidateCount: number;
}) {
  return (
    <header className="hero">
      <h1 className="sr-only">ホーム</h1>
      <nav aria-label="ホームの操作" className={styles.heroActions}>
        {hasHousehold ? (
          /* PCはこの導線、モバイルは下部のTodoタブから一覧へ移動する(#213)。 */
          <Link className={`${styles.accountLink} ${styles.todoListLink}`} href="/todos">
            Todo一覧
          </Link>
        ) : null}
        <Link className={`${styles.accountLink} ${styles.ledgerLink}`} href="/managed-items">
          家の台帳
        </Link>
      </nav>

      <div className={styles.summary} aria-label="対応状況">
        <HomeSummaryItem
          anchorId={HOME_TODO_SECTIONS_ANCHOR_ID}
          count={openItemCount}
          label="件の予定"
          linkLabel={`${String(openItemCount)}件の予定へ移動`}
        />
        <HomeSummaryItem
          anchorId={HOME_OVERDUE_ANCHOR_ID}
          count={overdueItemCount}
          label="件が期限切れ"
          linkLabel={`期限切れの${String(overdueItemCount)}件へ移動`}
        />
        <HomeSummaryItem
          anchorId={HOME_SHOPPING_CANDIDATES_ANCHOR_ID}
          count={shoppingCandidateCount}
          label="件 買っておきたいもの"
          linkLabel={`買っておきたいもの${String(shoppingCandidateCount)}件へ移動`}
        />
      </div>
    </header>
  );
}

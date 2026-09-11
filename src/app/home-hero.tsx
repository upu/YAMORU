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
// Issue #394: 対応が必要な件数ほど視線に入るよう、0件は数字を控えめにする
// (data-empty)。3項目が同じ高さの行を分け合うため、0件だけ枠を小さくは
// できない。サマリー全体が1行に収まること自体で、0件の指標が場所を
// 取りすぎないようにする。
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

  if (count === 0) {
    return <div className={styles.summaryItem} data-empty="true">{content}</div>;
  }

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

// Issue #219: PCにはサイドバー、モバイルには下部ナビゲーションがあり、どちらも
// Todo一覧と台帳への行き先を常に見せている。ホーム上部に置いていた「Todo一覧」
// 「家の台帳」のボタンは同じ行き先の二つ目の入口になるため外した(同じ移動先を
// 一画面に2か所出さない、#391の規約)。ホームは対応状況の把握に専念する。
export function HomeHero({
  openItemCount,
  overdueItemCount,
  shoppingCandidateCount,
}: {
  openItemCount: number;
  overdueItemCount: number;
  shoppingCandidateCount: number;
}) {
  return (
    <header className="hero">
      <h1 className="sr-only">ホーム</h1>
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
          // Issue #394: 3項目を1行に収めるため、サマリーでは短い表示ラベルを
          // 使う。移動先のセクション見出しは「買っておきたいもの」のままで、
          // 読み上げ名(linkLabel)にもそちらを使う。
          label="件 買うもの"
          linkLabel={`買っておきたいもの${String(shoppingCandidateCount)}件へ移動`}
        />
      </div>
    </header>
  );
}

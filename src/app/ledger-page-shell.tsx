import Link from "next/link";
import type { ReactNode } from "react";

import {
  LedgerCategoryNavigation,
  type LedgerCategory,
} from "./ledger-category-navigation";
import { ListAddLink, type ListAddAction } from "./list-add-link";
import styles from "./ledger-page.module.css";

// Issue #309: 台帳内でカテゴリを切り替えても、ページタイトル・説明・カテゴリ
// 切り替えの骨格を共通にする(issue本文の設計メモの第一候補)。/managed-itemsと
// /consumablesはURLもデータモデルも分けたまま(#291の方針)、この共通の
// ヘッダー領域の下でカテゴリ固有の一覧内容だけを差し替える。
export function LedgerPageShell({
  children,
  currentCategory,
  showCategoryNavigation = true,
}: {
  children: ReactNode;
  currentCategory?: LedgerCategory | undefined;
  showCategoryNavigation?: boolean;
}) {
  return (
    <main className="page-list ledger-page">
      {/* Issue #400: 台帳は一覧を日常的に確認・操作する画面なので、上部で
      縦幅を使わない。詳細画面の大見出し(.detail-hero)ではなく、Todo一覧・
      登録画面と同じ大きさのページ見出しに収め、説明も小さく1行に寄せる。
      英字のキッカー(HOUSE LEDGER)は見出しと同じことしか示さないため外した。 */}
      <header className={styles.header}>
        <h1 className={styles.title}>家の台帳</h1>
        <p className={styles.description}>
          家の備品、サービス・契約、消耗品をまとめます。
        </p>
      </header>

      {showCategoryNavigation ? (
        <LedgerCategoryNavigation current={currentCategory} />
      ) : null}
      {children}
    </main>
  );
}

// Issue #285: 検索欄へ入力しなくても新規登録の入口が見つかるように、検索・
// 絞り込みより前の行へ登録リンクを置く。件数バッジと同じ行に収めるため、
// 一覧確認を押し下げる高さを増やさない。Issue #309: この行を台帳の全カテゴリで
// 共通にし、文言と行き先だけを現在のカテゴリに合わせる(位置は動かさない)。
// Issue #391: モバイル幅ではこのリンクを出さず、右下のフローティングボタンを
// 主要導線にする(globals.cssの.list-add-link)。同じ追加操作が同時に2か所へ
// 出ないよう、どちらの幅でもリンクとボタンは同じ文言を使う。
export function LedgerListHeading({
  add,
  count,
}: {
  add: ListAddAction;
  count: number;
}) {
  return (
    <div className="list-heading">
      <ListAddLink add={add} />
      <span aria-label={`${String(count)}件`} className="count">{count}</span>
    </div>
  );
}

// Issue #309: 家庭未所属のときの案内も、台帳のどのカテゴリから来ても同じ
// 見た目にする。ページ見出し(h1「家の台帳」)の下に置くため、h2で示す。
export function LedgerHouseholdRequiredNotice() {
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

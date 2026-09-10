import Link from "next/link";

import styles from "./floating-add-button.module.css";

// Issue #309: 台帳のどのカテゴリを見ていても、追加操作は同じ位置・同じ名前で
// 見つかるようにする。Issue #391: 一覧では、この右下のボタンと一覧見出しの中の
// 追加リンク(globals.cssの.list-add-link)を同時に出さず、画面幅ごとに
// どちらか一方だけを主要導線にする。モバイル幅は親指の届くこのボタン、それより
// 広い幅は見出しの中のリンクを使うため、一覧はmobileOnlyを付けて呼ぶ。
// 表示・非表示はCSSのdisplay: noneで切り替えるので、隠れている側は支援技術
// からも見えず、同じ操作が二重に読み上げられない。
// ホームは一覧ではなく、見出しの中に追加リンクを持たないため、どの幅でも出す。
export function FloatingAddButton({
  href,
  label,
  mobileOnly = false,
}: {
  href: string;
  label: string;
  mobileOnly?: boolean;
}) {
  const modifier = mobileOnly ? ` ${styles.mobileOnly}` : "";

  return (
    <>
      <div aria-hidden="true" className={`${styles.space}${modifier}`} />
      <Link
        aria-label={label}
        className={`${styles.button}${modifier}`}
        href={href}
        title={label}
      >
        <span aria-hidden="true">＋</span>
      </Link>
    </>
  );
}

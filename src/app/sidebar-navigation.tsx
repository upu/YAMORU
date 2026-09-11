"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { PRIMARY_NAVIGATION_ITEMS } from "./primary-navigation";
import { isPublicPath } from "./public-paths";
import styles from "./sidebar-navigation.module.css";

// Issue #219: モバイル幅より広い画面には主要ナビゲーションが無く、行き先へ
// 移動するには共通ヘッダーのYAMORU(ホーム)しか無かった。広い横幅を使って
// 移動先を常時見せるサイドバーを置く。
//
// 項目・行き先・現在地の判定は下部ナビゲーションと同じprimary-navigation.tsx
// から受け取る。どちらを見ても同じ4項目・同じ行き先になり、モバイルの情報設計
// (ホーム・Todo・台帳)は変わらない。
//
// 表示の切り替えはCSSのdisplay: noneで行う(#391の追加導線と同じ方法)。
// 隠れている側は支援技術からも見えないため、同じ移動先が二重に読み上げられ
// たり、キーボードの移動順に現れたりしない。
export function SidebarNavigation() {
  const pathname = usePathname();
  if (isPublicPath(pathname)) return null;

  return (
    <nav aria-label="主要ナビゲーション" className={styles.sidebar}>
      <ul className={styles.items}>
        {PRIMARY_NAVIGATION_ITEMS.map((item) => (
          <li key={item.key}>
            <Link
              aria-current={item.isCurrent(pathname) ? "page" : undefined}
              className={styles.item}
              href={item.href}
            >
              {item.icon}
              <span className={styles.label}>{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

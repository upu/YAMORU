"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { PRIMARY_NAVIGATION_ITEMS } from "./primary-navigation";
import { isPublicPath } from "./public-paths";
import styles from "./mobile-bottom-navigation.module.css";

// Issue #146 / #350: モバイル幅の主要ナビゲーション。項目・行き先・現在地の
// 判定はPCのサイドバーと同じprimary-navigation.tsxから受け取り、画面幅で
// 見た目だけを変える(Issue #219)。
export function MobileBottomNavigation() {
  const pathname = usePathname();
  if (isPublicPath(pathname)) return null;

  return (
    <>
      <div aria-hidden="true" className={styles.space} />
      <nav aria-label="主要ナビゲーション" className={styles.navigation}>
        {PRIMARY_NAVIGATION_ITEMS.map((item) => (
          <Link
            aria-current={item.isCurrent(pathname) ? "page" : undefined}
            href={item.href}
            key={item.key}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isPublicPath } from "./public-paths";
import styles from "./mobile-bottom-navigation.module.css";

function HomeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m3.5 10.5 8.5-7 8.5 7" />
      <path d="M5.5 9v11h13V9M9.5 20v-6h5v6" />
    </svg>
  );
}

function TodoIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m3.5 6 1.4 1.4L7.5 4.8M9.5 6H20" />
      <path d="m3.5 12 1.4 1.4 2.6-2.6M9.5 12H20" />
      <path d="m3.5 18 1.4 1.4 2.6-2.6M9.5 18H20" />
    </svg>
  );
}

function LedgerIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 4.5h11.5A2.5 2.5 0 0 1 19 7v12.5H7A2 2 0 0 1 5 17.5v-13Z" />
      <path d="M5 17.5A2.5 2.5 0 0 1 7.5 15H19M9 8h6" />
    </svg>
  );
}

// Issue #350 / YDR-042: 横断検索は「画面を選ばず名前から対象へ到達する」
// 日常操作なので、補助メニューの奥ではなく主要ナビゲーションへ常設する
// (Issue #242の案1)。共通ヘッダーへ虫眼鏡を置く案は、Todo一覧の画面内検索の
// 虫眼鏡(#241)と意味が重なるため採らない。
function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m15.8 15.8 4.2 4.2" />
    </svg>
  );
}

export function MobileBottomNavigation() {
  const pathname = usePathname();
  if (isPublicPath(pathname)) return null;

  const isHome = pathname === "/";
  const isTodo = pathname === "/todos" || pathname.startsWith("/todos/");
  const isLedger =
    pathname === "/managed-items" ||
    pathname.startsWith("/managed-items/") ||
    pathname === "/consumables" ||
    pathname.startsWith("/consumables/");
  const isSearch = pathname === "/search";

  return (
    <>
      <div aria-hidden="true" className={styles.space} />
      <nav aria-label="主要ナビゲーション" className={styles.navigation}>
        <Link aria-current={isHome ? "page" : undefined} href="/">
          <HomeIcon />
          <span>ホーム</span>
        </Link>
        <Link aria-current={isTodo ? "page" : undefined} href="/todos">
          <TodoIcon />
          <span>Todo</span>
        </Link>
        <Link
          aria-current={isLedger ? "page" : undefined}
          href="/managed-items?kind=asset"
        >
          <LedgerIcon />
          <span>台帳</span>
        </Link>
        <Link aria-current={isSearch ? "page" : undefined} href="/search">
          <SearchIcon />
          <span>検索</span>
        </Link>
      </nav>
    </>
  );
}

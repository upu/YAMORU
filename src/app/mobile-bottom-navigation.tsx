"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isPublicPath } from "./public-paths";

function HomeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m3.5 10.5 8.5-7 8.5 7" />
      <path d="M5.5 9v11h13V9M9.5 20v-6h5v6" />
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

export function MobileBottomNavigation() {
  const pathname = usePathname();
  if (isPublicPath(pathname)) return null;

  const isHome = pathname === "/";
  const isLedger =
    pathname === "/managed-items" || pathname.startsWith("/managed-items/");

  return (
    <>
      <div aria-hidden="true" className="mobile-bottom-navigation-space" />
      <nav aria-label="主要ナビゲーション" className="mobile-bottom-navigation">
        <Link aria-current={isHome ? "page" : undefined} href="/">
          <HomeIcon />
          <span>ホーム</span>
        </Link>
        <Link
          aria-current={isLedger ? "page" : undefined}
          href="/managed-items"
        >
          <LedgerIcon />
          <span>台帳</span>
        </Link>
      </nav>
    </>
  );
}

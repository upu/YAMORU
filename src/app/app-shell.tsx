"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { isPublicPath } from "./public-paths";
import styles from "./app-shell.module.css";

// Issue #219: サイドバーはposition: fixedで画面の左端を占めるため、ヘッダー・
// 本文・フッターをその幅だけ右へ寄せる。寄せる条件はサイドバーを出す条件と
// 同じ(公開画面・認証画面では出さない)。bodyへ一律に余白を置くと、
// サイドバーの無いログイン・招待受諾の画面まで左側が空いてしまう。
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className={isPublicPath(pathname) ? undefined : styles.withSidebar}>
      {children}
    </div>
  );
}

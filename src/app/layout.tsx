import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { AppFooter } from "./app-footer";
import { AppHeader } from "./app-header";
import { AppShell } from "./app-shell";
import { APP_VERSION_INFO } from "./app-version";
import { MobileBottomNavigation } from "./mobile-bottom-navigation";
import { RefreshCoordinator } from "./refresh-coordinator";
import { RefreshOnVisible } from "./refresh-on-visible";
import { SidebarNavigation } from "./sidebar-navigation";

export const metadata: Metadata = {
  title: "YAMORU",
  description: "暮らしの「いつだっけ？」をなくす。",
  appleWebApp: {
    capable: true,
    startupImage: [
      {
        media:
          "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
        url: "/pwa/yamoru-startup-iphone-16-portrait.png",
      },
    ],
    statusBarStyle: "default",
    title: "YAMORU",
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#315c49",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja">
      <body>
        <RefreshCoordinator>
          <RefreshOnVisible />
          {/* Issue #219: モバイル幅より広い画面の主要ナビゲーション。
          下部ナビゲーションとは画面幅で出し分ける(CSSのdisplay: none)。
          AppShellは、サイドバーを出す画面でだけ本文をその幅だけ右へ寄せる。 */}
          <SidebarNavigation />
          <AppShell>
            <AppHeader />
            {children}
            <AppFooter versionInfo={APP_VERSION_INFO} />
          </AppShell>
          <MobileBottomNavigation />
        </RefreshCoordinator>
      </body>
    </html>
  );
}

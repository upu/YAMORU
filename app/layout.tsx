import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { RefreshOnVisible } from "./refresh-on-visible";

export const metadata: Metadata = {
  title: "YAMORU",
  description: "暮らしの「いつだっけ？」をなくす。",
  // iOSが以前のmanifest取得失敗を再利用しないよう、参照URLを更新する。
  manifest: "/manifest.webmanifest?v=3",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "YAMORU",
  },
  icons: {
    apple: [
      {
        url: "/pwa/yamoru-icon-v3-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
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
        <RefreshOnVisible />
        {children}
      </body>
    </html>
  );
}

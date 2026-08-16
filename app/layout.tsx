import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { RefreshOnVisible } from "./refresh-on-visible";

export const metadata: Metadata = {
  title: "YAMORU",
  description: "暮らしの「いつだっけ？」をなくす。",
  appleWebApp: {
    capable: true,
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
        <RefreshOnVisible />
        {children}
      </body>
    </html>
  );
}

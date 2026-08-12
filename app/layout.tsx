import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { DemoStateProvider } from "./demo-state";
import "./globals.css";

export const metadata: Metadata = {
  title: "YAMORU",
  description: "暮らしの「いつだっけ？」をなくす。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja">
      <body><DemoStateProvider>{children}</DemoStateProvider></body>
    </html>
  );
}

"use client";

import type { AppVersionInfo } from "./app-version";
import { isPublicPath } from "./public-paths";
import { usePathname } from "next/navigation";
import styles from "./app-footer.module.css";

export function AppFooter({ versionInfo }: { versionInfo: AppVersionInfo }) {
  const pathname = usePathname();
  if (isPublicPath(pathname)) return null;

  return (
    <footer className={styles.footer}>
      <span className={styles.mark} aria-hidden="true">Y</span>
      <p>YAMORU {versionInfo.version}</p>
    </footer>
  );
}

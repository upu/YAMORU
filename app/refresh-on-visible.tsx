"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

// YDR-005: Realtimeも定期pollingも使わず、アプリ表示時・フォーカス復帰時・
// 明示的な再読み込みだけで最新化する。すべてのページのServer Componentが
// 出すデータを対象にするため、RootLayoutに一つだけ置いて全画面へ効かせる
// (Issue #71)。router.refresh()はサーバー側の出力だけを再取得し、各Client
// Componentが持つuseState等のクライアント状態は再マウントされない限り保た
// れるため、入力途中のフォームを失わない。
const REFRESH_COOLDOWN_MS = 2000;

export function RefreshOnVisible({
  cooldownMs = REFRESH_COOLDOWN_MS,
}: {
  // テストからクールダウン時間を短縮できるようにする。
  cooldownMs?: number;
} = {}) {
  const router = useRouter();
  // 「表示に戻った」ことを示すイベントはvisibilitychange・focus・pageshowが
  // ほぼ同時に重なって発火しうる。直近の再取得からcooldownMs未満なら無視する。
  const lastRefreshAtRef = useRef(-Infinity);

  useEffect(() => {
    function refreshIfDue() {
      const now = Date.now();
      if (now - lastRefreshAtRef.current < cooldownMs) return;
      lastRefreshAtRef.current = now;
      router.refresh();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") refreshIfDue();
    }

    function handleFocus() {
      refreshIfDue();
    }

    // bfcache(ブラウザの戻る/進むキャッシュ)から復元された表示は
    // visibilitychangeを発火しないページ遷移経路があるため、pageshowの
    // persistedフラグで別途拾う。
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) refreshIfDue();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [cooldownMs, router]);

  return null;
}

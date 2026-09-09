"use client";

import { useCallback, useSyncExternalStore } from "react";

import styles from "./first-run-hint.module.css";

/* Issue #361: 通常のUIはアイコン中心のコンパクト表示にし、意味が分かりにくい
   操作だけ、初めて見るときに短いヒントを重ねる。既読状態はブラウザローカルに
   持ち、利用者設定やチュートリアル基盤は増やさない。 */
export type FirstRunHintId = "consumable-pin";

const STORAGE_KEY_PREFIX = "yamoru.hint-seen.";

function storageKey(hintId: FirstRunHintId) {
  return `${STORAGE_KEY_PREFIX}${hintId}`;
}

// localStorageを読めない環境(プライベートモード等)では既読扱いにする。
// 記録できないまま表示すると、同じヒントを毎回出してしまうため。
function hasSeenHint(hintId: FirstRunHintId) {
  try {
    return window.localStorage.getItem(storageKey(hintId)) !== null;
  } catch {
    return true;
  }
}

function markHintSeen(hintId: FirstRunHintId) {
  try {
    window.localStorage.setItem(storageKey(hintId), "seen");
  } catch {
    // 記録できなくても操作自体は続けられるので、失敗は無視する。
  }
}

// 既読状態はReactの外(localStorage)にあるので、useSyncExternalStoreで購読する。
// サーバー描画とhydrationでは既読扱いにして、ブラウザで判定した結果だけを出す。
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyHintChanged() {
  for (const listener of listeners) listener();
}

export function useFirstRunHint(hintId: FirstRunHintId) {
  const getSnapshot = useCallback(() => hasSeenHint(hintId), [hintId]);
  const isSeen = useSyncExternalStore(subscribe, getSnapshot, () => true);

  const dismiss = useCallback(() => {
    markHintSeen(hintId);
    notifyHintChanged();
  }, [hintId]);

  return { dismiss, isVisible: !isSeen };
}

export function FirstRunHint({
  children,
  id,
  onDismiss,
}: {
  children: React.ReactNode;
  id: string;
  onDismiss: () => void;
}) {
  return (
    <div className={styles.hint} id={id}>
      <p className={styles.text}>{children}</p>
      <button className={styles.dismiss} onClick={onDismiss} type="button">
        <span aria-hidden="true">×</span>
        <span className="sr-only">ヒントを閉じる</span>
      </button>
    </div>
  );
}

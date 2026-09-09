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

// 読めても書けない環境(容量制限やプライバシー設定)がある。書き込みを実際に
// 試し、既読を記録できないと分かったらヒント自体を出さない。記録できないまま
// 出すと、同じヒントを毎回繰り返してしまうため。
let canPersist: boolean | undefined;

function canPersistHints() {
  if (canPersist === undefined) {
    try {
      const probeKey = `${STORAGE_KEY_PREFIX}probe`;
      window.localStorage.setItem(probeKey, "1");
      window.localStorage.removeItem(probeKey);
      canPersist = true;
    } catch {
      canPersist = false;
    }
  }
  return canPersist;
}

// probeが通っても本番の書き込みが失敗することはある(別タブが容量を使い切る、
// 権限が変わる)。そのときも閉じたヒントがその場で戻らないよう、この読み込みの
// あいだは既読として覚えておく。
const seenInSession = new Set<FirstRunHintId>();

function hasSeenHint(hintId: FirstRunHintId) {
  if (seenInSession.has(hintId)) return true;
  if (!canPersistHints()) return true;
  try {
    return window.localStorage.getItem(storageKey(hintId)) !== null;
  } catch {
    return true;
  }
}

function markHintSeen(hintId: FirstRunHintId) {
  seenInSession.add(hintId);
  try {
    window.localStorage.setItem(storageKey(hintId), "seen");
  } catch {
    // 次回以降は残せないが、この読み込みのあいだは既読として扱う。
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

"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const REFRESH_COOLDOWN_MS = 2000;
const MINIMUM_PENDING_MS = 400;
const SUCCESS_VISIBLE_MS = 1600;

type RefreshSource = "automatic" | "manual";
type RefreshStatus = "error" | "idle" | "refreshing" | "success";

type RefreshContextValue = {
  requestRefresh: (source: RefreshSource) => void;
  status: RefreshStatus;
};

const RefreshContext = createContext<RefreshContextValue | null>(null);

type RefreshStatusController = {
  clearSuccessTimer: () => void;
  isMountedRef: RefObject<boolean>;
  setStatus: Dispatch<SetStateAction<RefreshStatus>>;
  showSuccess: () => void;
  status: RefreshStatus;
};

function wait(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function useRefreshStatus(successVisibleMs: number): RefreshStatusController {
  const [status, setStatus] = useState<RefreshStatus>("idle");
  const isMountedRef = useRef(true);
  const successTimerRef = useRef<number | null>(null);

  const clearSuccessTimer = useCallback(() => {
    if (successTimerRef.current === null) return;
    window.clearTimeout(successTimerRef.current);
    successTimerRef.current = null;
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearSuccessTimer();
    };
  }, [clearSuccessTimer]);

  const showSuccess = useCallback(() => {
    if (!isMountedRef.current) return;
    setStatus("success");
    clearSuccessTimer();
    successTimerRef.current = window.setTimeout(() => {
      if (isMountedRef.current) setStatus("idle");
    }, successVisibleMs);
  }, [clearSuccessTimer, successVisibleMs]);

  return { clearSuccessTimer, isMountedRef, setStatus, showSuccess, status };
}

function useRefreshRequest({
  cooldownMs,
  minimumPendingMs,
  performRefresh,
  statusController: { clearSuccessTimer, isMountedRef, setStatus, showSuccess },
}: {
  cooldownMs: number;
  minimumPendingMs: number;
  performRefresh: () => Promise<void>;
  statusController: RefreshStatusController;
}) {
  const isRefreshingRef = useRef(false);
  const lastSuccessfulRefreshAtRef = useRef(-Infinity);

  return useCallback((source: RefreshSource) => {
    if (isRefreshingRef.current) return;

    const now = performance.now();
    if (now - lastSuccessfulRefreshAtRef.current < cooldownMs) {
      if (source === "manual") showSuccess();
      return;
    }

    isRefreshingRef.current = true;
    clearSuccessTimer();
    setStatus("refreshing");

    void (async () => {
      try {
        await Promise.all([performRefresh(), wait(minimumPendingMs)]);
        lastSuccessfulRefreshAtRef.current = performance.now();
        showSuccess();
      } catch {
        if (isMountedRef.current) setStatus("error");
      } finally {
        isRefreshingRef.current = false;
      }
    })();
  }, [
    clearSuccessTimer,
    cooldownMs,
    isMountedRef,
    minimumPendingMs,
    performRefresh,
    setStatus,
    showSuccess,
  ]);
}

function useRefreshCoordinator({
  cooldownMs = REFRESH_COOLDOWN_MS,
  minimumPendingMs = MINIMUM_PENDING_MS,
  refreshPage,
  successVisibleMs = SUCCESS_VISIBLE_MS,
}: {
  cooldownMs?: number;
  minimumPendingMs?: number;
  refreshPage?: () => Promise<void> | void;
  successVisibleMs?: number;
}): RefreshContextValue {
  const router = useRouter();
  const statusController = useRefreshStatus(successVisibleMs);

  const performRefresh = useCallback(async () => {
    // router.refresh()は失敗Promiseを返さないため、少なくとも既知のオフライン時は
    // 現在表示を保ったまま、Next.jsへ更新を渡す前に再試行案内へ切り替える。
    if (!navigator.onLine) {
      throw new Error("offline");
    }
    if (refreshPage) {
      await refreshPage();
      return;
    }
    router.refresh();
  }, [refreshPage, router]);

  const requestRefresh = useRefreshRequest({
    cooldownMs,
    minimumPendingMs,
    performRefresh,
    statusController,
  });

  return useMemo(
    () => ({ requestRefresh, status: statusController.status }),
    [requestRefresh, statusController.status],
  );
}

export function RefreshCoordinator({
  children,
  cooldownMs,
  minimumPendingMs,
  refreshPage,
  successVisibleMs,
}: {
  children: ReactNode;
  cooldownMs?: number;
  minimumPendingMs?: number;
  refreshPage?: () => Promise<void> | void;
  successVisibleMs?: number;
}) {
  const value = useRefreshCoordinator({
    cooldownMs,
    minimumPendingMs,
    refreshPage,
    successVisibleMs,
  });

  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>;
}

export function useRefresh() {
  const context = useContext(RefreshContext);
  if (context === null) {
    throw new Error("useRefresh must be used inside RefreshCoordinator");
  }
  return context;
}

function RefreshIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M20 11a8 8 0 1 0-2.3 6.1" />
      <path d="M20 4v7h-7" />
    </svg>
  );
}

export function ManualRefreshButton() {
  const { requestRefresh, status } = useRefresh();
  const isRefreshing = status === "refreshing";

  return (
    <div className="refresh-control">
      <button
        aria-label="最新状態に更新"
        className="refresh-button"
        disabled={isRefreshing}
        onClick={() => {
          requestRefresh("manual");
        }}
        type="button"
      >
        <RefreshIcon />
      </button>
      {isRefreshing ? (
        <span aria-live="polite" className="sr-only">更新中…</span>
      ) : null}
      {status === "success" ? (
        <p aria-live="polite" className="refresh-feedback" role="status">
          更新しました
        </p>
      ) : null}
      {status === "error" ? (
        <div className="refresh-feedback refresh-feedback-error" role="alert">
          <span>更新できませんでした。現在の表示はそのままです。</span>
          <button
            onClick={() => {
              requestRefresh("manual");
            }}
            type="button"
          >
            再試行
          </button>
        </div>
      ) : null}
    </div>
  );
}

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { routerRefreshMock } = vi.hoisted(() => ({
  routerRefreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefreshMock }),
}));

import { ManualRefreshButton, RefreshCoordinator } from "../app/refresh-coordinator";
import { RefreshOnVisible } from "../app/refresh-on-visible";

function deferredPromise() {
  let reject!: (reason?: unknown) => void;
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("手動更新の調停(Issue #149)", () => {
  it("router.refresh()を呼び、更新中表示を解除する", async () => {
    render(
      <StrictMode>
        <RefreshCoordinator minimumPendingMs={0}>
          <ManualRefreshButton />
        </RefreshCoordinator>
      </StrictMode>,
    );

    fireEvent.click(screen.getByRole("button", { name: "最新状態に更新" }));

    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByText("更新しました")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "最新状態に更新" })).toBeEnabled();
  });

  it("更新中はボタンを無効化し、完了を通知する", async () => {
    const refresh = deferredPromise();
    const refreshPage = vi.fn(() => refresh.promise);
    render(
      <RefreshCoordinator minimumPendingMs={0} refreshPage={refreshPage}>
        <ManualRefreshButton />
      </RefreshCoordinator>,
    );

    fireEvent.click(screen.getByRole("button", { name: "最新状態に更新" }));

    expect(refreshPage).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "最新状態に更新" })).toBeDisabled();
    expect(screen.getByText("更新中…")).toBeInTheDocument();

    refresh.resolve();

    await waitFor(() => {
      expect(screen.getByText("更新しました")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "最新状態に更新" })).toBeEnabled();
  });

  it("失敗時は現在表示を残して案内し、同じ場所から再試行できる", async () => {
    const refreshPage = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce();
    render(
      <RefreshCoordinator minimumPendingMs={0} refreshPage={refreshPage}>
        <ManualRefreshButton />
        <p>現在の画面内容</p>
      </RefreshCoordinator>,
    );

    fireEvent.click(screen.getByRole("button", { name: "最新状態に更新" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("更新できませんでした。現在の表示はそのままです。");
    expect(screen.getByText("現在の画面内容")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "再試行" }));

    await waitFor(() => {
      expect(refreshPage).toHaveBeenCalledTimes(2);
      expect(screen.getByText("更新しました")).toBeInTheDocument();
    });
  });

  it("自動更新中の手動操作を重複実行しない", async () => {
    const refresh = deferredPromise();
    const refreshPage = vi.fn(() => refresh.promise);
    render(
      <RefreshCoordinator minimumPendingMs={0} refreshPage={refreshPage}>
        <RefreshOnVisible />
        <ManualRefreshButton />
      </RefreshCoordinator>,
    );

    window.dispatchEvent(new Event("focus"));
    fireEvent.click(screen.getByRole("button", { name: "最新状態に更新" }));

    expect(refreshPage).toHaveBeenCalledTimes(1);

    refresh.resolve();
    await waitFor(() => {
      expect(screen.getByText("更新しました")).toBeInTheDocument();
    });
  });
});

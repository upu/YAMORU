import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refreshMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { RefreshOnVisible } from "../app/refresh-on-visible";

function setVisibilityState(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

function firePageShow(persisted: boolean) {
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: persisted });
  window.dispatchEvent(event);
}

beforeEach(() => {
  vi.clearAllMocks();
  setVisibilityState("visible");
});

afterEach(() => {
  cleanup();
  setVisibilityState("visible");
});

describe("RefreshOnVisible", () => {
  it("非表示から表示に戻ったときにrouter.refresh()を呼ぶ", () => {
    render(<RefreshOnVisible />);

    setVisibilityState("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refreshMock).not.toHaveBeenCalled();

    setVisibilityState("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("フォーカス復帰時にrouter.refresh()を呼ぶ", () => {
    render(<RefreshOnVisible />);

    window.dispatchEvent(new Event("focus"));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("bfcacheからの復元(pageshow persisted)でrouter.refresh()を呼ぶ", () => {
    render(<RefreshOnVisible />);

    firePageShow(false);
    expect(refreshMock).not.toHaveBeenCalled();

    firePageShow(true);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("クールダウン時間内の重複イベントでは連続取得しない", () => {
    render(<RefreshOnVisible cooldownMs={2000} />);

    const nowSpy = vi.spyOn(performance, "now").mockReturnValue(0);

    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    firePageShow(true);
    expect(refreshMock).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(1000);
    window.dispatchEvent(new Event("focus"));
    expect(refreshMock).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(2500);
    window.dispatchEvent(new Event("focus"));
    expect(refreshMock).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  it("システム時計(Date.now)が巻き戻ってもクールダウン判定に影響しない(performance.nowは単調増加)", () => {
    render(<RefreshOnVisible cooldownMs={2000} />);

    const perfSpy = vi.spyOn(performance, "now").mockReturnValue(10_000);
    // NTP補正などでシステム時計が巻き戻る状況を模す。クールダウン判定が
    // Date.now()に依存していれば、この巻き戻りだけで負の差分が生じ、
    // 以降の正当な再取得が抑止され続けてしまう。
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);

    window.dispatchEvent(new Event("focus"));
    expect(refreshMock).toHaveBeenCalledTimes(1);

    dateSpy.mockReturnValue(0);
    perfSpy.mockReturnValue(12_500);

    window.dispatchEvent(new Event("focus"));
    expect(refreshMock).toHaveBeenCalledTimes(2);

    perfSpy.mockRestore();
    dateSpy.mockRestore();
  });

  it("アンマウント後はイベントに反応しない", () => {
    const { unmount } = render(<RefreshOnVisible />);
    unmount();

    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    firePageShow(true);

    expect(refreshMock).not.toHaveBeenCalled();
  });
});

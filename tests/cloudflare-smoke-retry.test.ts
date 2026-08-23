import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SMOKE_RETRY_POLICY,
  runWithRetry,
  type RetryFailure,
} from "../scripts/cloudflare-smoke-retry";

function fakeSleep(calls: number[]): (delayMs: number) => Promise<void> {
  return (delayMs: number) => {
    calls.push(delayMs);
    return Promise.resolve();
  };
}

describe("上限付き再試行(#152)", () => {
  it("初回成功時は1回だけ実行し、待機もretry通知も発生しない", async () => {
    const run = vi.fn(() => Promise.resolve("ok"));
    const onRetry = vi.fn<(failure: RetryFailure) => void>();
    const sleepCalls: number[] = [];

    const result = await runWithRetry(run, DEFAULT_SMOKE_RETRY_POLICY, {
      onRetry,
      sleep: fakeSleep(sleepCalls),
    });

    expect(result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
    expect(sleepCalls).toEqual([]);
  });

  it("一時的な失敗の後に成功へ切り替わるケースは成功する", async () => {
    let attempts = 0;
    const run = vi.fn(() => {
      attempts += 1;
      if (attempts < 3) {
        return Promise.reject(new Error(`一時的な不一致(試行${String(attempts)})`));
      }
      return Promise.resolve("recovered");
    });
    const onRetry = vi.fn<(failure: RetryFailure) => void>();
    const sleepCalls: number[] = [];

    const result = await runWithRetry(run, DEFAULT_SMOKE_RETRY_POLICY, {
      onRetry,
      sleep: fakeSleep(sleepCalls),
    });

    expect(result).toBe("recovered");
    expect(run).toHaveBeenCalledTimes(3);
    // 上限(delaysMs)の範囲内で、失敗のたびに待機し試行番号を通知する。
    expect(sleepCalls).toEqual([1000, 2000]);
    expect(onRetry.mock.calls.map(([failure]) => failure)).toEqual([
      { attempt: 1, maxAttempts: 4, reason: "一時的な不一致(試行1)" },
      { attempt: 2, maxAttempts: 4, reason: "一時的な不一致(試行2)" },
    ]);
  });

  it("上限まで異常が継続するケースは最終エラーを投げ、規定回数で打ち切る", async () => {
    const run = vi.fn(() => Promise.reject(new Error("継続する異常")));
    const sleepCalls: number[] = [];

    await expect(
      runWithRetry(run, DEFAULT_SMOKE_RETRY_POLICY, {
        sleep: fakeSleep(sleepCalls),
      }),
    ).rejects.toThrow("継続する異常");

    expect(run).toHaveBeenCalledTimes(DEFAULT_SMOKE_RETRY_POLICY.maxAttempts);
    // 待機回数は試行回数-1回(最終試行の後は待機しない)。
    expect(sleepCalls).toHaveLength(
      DEFAULT_SMOKE_RETRY_POLICY.maxAttempts - 1,
    );
  });

  it("待機時間の上限を明確に持ち、delaysMsを使い切ったら最後の値を繰り返す", async () => {
    const policy = { delaysMs: [10, 20], maxAttempts: 5 };
    const run = vi.fn(() => Promise.reject(new Error("常に失敗")));
    const sleepCalls: number[] = [];

    await expect(
      runWithRetry(run, policy, { sleep: fakeSleep(sleepCalls) }),
    ).rejects.toThrow("常に失敗");

    expect(sleepCalls).toEqual([10, 20, 20, 20]);
  });
});

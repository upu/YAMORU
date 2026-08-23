// Cloudflareへの新しいWorker version反映直後は、数秒程度smokeが一時的に
// 古い応答を観測することがある(#152)。上限付きの再試行だけでこの伝播差を
// 吸収し、それ以外の異常は上限まで再試行しても最終的に必ず失敗として扱う。
export type RetryPolicy = {
  readonly delaysMs: readonly number[];
  readonly maxAttempts: number;
};

// 初回失敗後: 1秒 → 2秒 → 4秒(最大4回試行、追加待機の合計は最大7秒)。
export const DEFAULT_SMOKE_RETRY_POLICY: RetryPolicy = {
  delaysMs: [1000, 2000, 4000],
  maxAttempts: 4,
};

export type RetryFailure = {
  attempt: number;
  maxAttempts: number;
  reason: string;
};

export type RetryHooks = {
  onRetry?: (failure: RetryFailure) => void;
  sleep?: (delayMs: number) => Promise<void>;
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "不明なエラー";
}

// attemptは1始まり。1回目の失敗直後の待機はdelaysMs[0]を使う。
// policy.maxAttemptsとdelaysMs.lengthの食い違いで範囲外にならないよう、
// 上限を超えたら配列の最後の待機時間を使う(明確な上限を保つ)。
function delayForAttempt(policy: RetryPolicy, attempt: number): number {
  const index = Math.min(attempt - 1, policy.delaysMs.length - 1);
  return policy.delaysMs[index] ?? 0;
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

// runを上限付きで再試行する。成功したら即座に結果を返し、以降の試行や待機は
// 行わない。最終試行まで失敗し続けた場合は、直近のエラーをそのまま投げる。
export async function runWithRetry<T>(
  run: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  hooks: RetryHooks = {},
): Promise<T> {
  const sleep = hooks.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return await run(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === policy.maxAttempts) break;
      hooks.onRetry?.({
        attempt,
        maxAttempts: policy.maxAttempts,
        reason: describeError(error),
      });
      await sleep(delayForAttempt(policy, attempt));
    }
  }
  throw lastError;
}

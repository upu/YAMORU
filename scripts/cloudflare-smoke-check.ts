import {
  assertSmokeResponse,
  type SmokeCheck,
  type SmokeResponse,
} from "./cloudflare-smoke-contract.ts";
import {
  DEFAULT_SMOKE_RETRY_POLICY,
  runWithRetry,
  type RetryPolicy,
} from "./cloudflare-smoke-retry.ts";

// リダイレクト先パスや期待するContent-Typeなど、自分たちのcheck定義に
// もともと書かれている値だけを組み立てる。response本文やquery、認証情報、
// 招待tokenは一切参照しない。
function describeExpectation(check: SmokeCheck): string {
  if (check.kind === "redirect") {
    return `${check.expectedLocationPath ?? "?"}へのredirect`;
  }
  const parts = ["status 200"];
  if (check.expectedContentType !== undefined) {
    parts.push(`Content-Type ${check.expectedContentType}`);
  }
  if (check.expectedText !== undefined) parts.push("公開内容を含む本文");
  return parts.join(" / ");
}

// assertSmokeResponse・fetchが投げるエラーのmessageだけを使う。どちらも
// pathnameや観測したstatusまでしか含めておらず、response body・query・
// 認証情報・招待token・Secret値を含まない。
function describeFailureReason(error: unknown): string {
  return error instanceof Error ? error.message : "不明なエラー";
}

// lastResponseは再試行のコールバック内でだけ更新されるため、呼び出し側の
// スコープでnullを狭めた型として扱わせる目的で引数として切り出す。
function describeLastStatus(response: SmokeResponse | null): string {
  return response === null ? "取得不可" : String(response.status);
}

export type SmokeCheckRetryFailure = {
  attempt: number;
  maxAttempts: number;
  pathname: string;
  reason: string;
};

export type SmokeCheckRetryHooks = {
  onRetry?: (failure: SmokeCheckRetryFailure) => void;
};

// 1つの公開境界checkを上限付きで再試行する(#152)。Cloudflareへの新しい
// Worker version反映直後の一時的な伝播差を吸収するためで、初回成功時は
// 追加のfetchも待機も発生しない。上限まで異常が続いた場合は、最後に観測した
// status・pathname・期待条件を含めて失敗させ、誤って成功扱いにしない。
export async function runSmokeCheckWithRetry(
  check: SmokeCheck,
  fetchResponse: () => Promise<SmokeResponse>,
  policy: RetryPolicy = DEFAULT_SMOKE_RETRY_POLICY,
  hooks: SmokeCheckRetryHooks = {},
): Promise<void> {
  let lastResponse: SmokeResponse | null = null;
  try {
    await runWithRetry(
      async () => {
        const response = await fetchResponse();
        lastResponse = response;
        assertSmokeResponse(check, response);
      },
      policy,
      {
        onRetry: ({ attempt, maxAttempts, reason }) => {
          hooks.onRetry?.({ attempt, maxAttempts, pathname: check.pathname, reason });
        },
      },
    );
  } catch (error) {
    const status = describeLastStatus(lastResponse);
    throw new Error(
      `${check.pathname}は${String(policy.maxAttempts)}回試行しても確認できませんでした` +
        `(最終status: ${status}, 期待: ${describeExpectation(check)})。` +
        `直近の理由: ${describeFailureReason(error)}`,
    );
  }
}

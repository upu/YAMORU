// Next.jsのonRequestErrorが受け取る文脈のうち、ログへ残してよい項目だけを写す。
// 呼び出し側が渡すerrorRequestは意図的に扱わない。pathはquery文字列を含み、
// headersはセッションcookieを含むため、そのまま記録すると
// docs/references/cloudflare-production-operations.mdの
// 「秘密情報をログへ出さない」に反する(#190)。
export type RequestErrorContext = {
  renderSource?: string | undefined;
  routePath: string;
  routeType: string;
  routerKind: string;
};

// Workers Logsから機械的に絞り込めるよう、値の有無で形が変わらない
// 固定のJSONにする。
export type RequestErrorLog = {
  digest: string | null;
  event: "yamoru.request_error";
  message: string;
  name: string;
  renderSource: string | null;
  routePath: string;
  routeType: string;
  routerKind: string;
};

// 想定外に長いメッセージ1件でログ1行を占有させない。
const MAX_MESSAGE_LENGTH = 500;

type ErrorSummary = { digest: string | null; message: string; name: string };

function truncate(value: string): string {
  return value.length <= MAX_MESSAGE_LENGTH
    ? value
    : `${value.slice(0, MAX_MESSAGE_LENGTH)}…`;
}

function describeError(error: unknown): ErrorSummary {
  if (error instanceof Error) {
    // Next.jsはサーバ側の例外にdigestを付け、同じ値をクライアントの
    // エラー画面へ渡す。利用者からの報告とログを突き合わせるために残す。
    const { digest } = error as Error & { digest?: unknown };
    return {
      digest: typeof digest === "string" ? digest : null,
      message: truncate(error.message),
      name: error.name,
    };
  }
  if (typeof error === "string") {
    return { digest: null, message: truncate(error), name: "string" };
  }
  return { digest: null, message: "", name: typeof error };
}

export function buildRequestErrorLog(
  error: unknown,
  context: RequestErrorContext,
): RequestErrorLog {
  const summary = describeError(error);
  return {
    digest: summary.digest,
    event: "yamoru.request_error",
    message: summary.message,
    name: summary.name,
    renderSource: context.renderSource ?? null,
    // routePathは"/household"のような経路の型であり、具体的なURLでは
    // ないため、招待claimのようなquery上の秘密を含まない。
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
  };
}

export function formatRequestErrorLog(
  error: unknown,
  context: RequestErrorContext,
): string {
  return JSON.stringify(buildRequestErrorLog(error, context));
}

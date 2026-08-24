import {
  formatRequestErrorLog,
  type RequestErrorContext,
} from "./lib/observability/request-error";

// Next.jsが、サーバ側レンダリング・Route Handler・Server Actionで
// 処理されなかった例外ごとに呼ぶ。#190では/householdの500が
// Workers Logsへ無名のスタックしか残さず、D1が何を返したのかを
// 事後に特定できなかった。ここで種別と発生経路を構造化して記録する。
export function onRequestError(
  error: unknown,
  _request: Readonly<{ headers: unknown; method: string; path: string }>,
  context: Readonly<RequestErrorContext>,
): void {
  console.error(formatRequestErrorLog(error, context));
}

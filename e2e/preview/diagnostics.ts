import type { Page, TestInfo } from "@playwright/test";

// preview E2Eが失敗したときに、どの段階で何が起きたかを秘密情報なしで残す(#190)。
// 招待の生tokenはURL fragment(YDR-024)、招待claimはquery、認証はcookieに載る。
// そのため記録するのはpathname・HTTPメソッド・status・テスト開始からの
// 経過時間だけにし、URL全体もヘッダーも本文も残さない。
type NavigationRecord = {
  elapsedMs: number;
  label: string;
  method: string;
  pathname: string;
  status: number;
};

const navigations: NavigationRecord[] = [];
let startedAt = Date.now();

export function resetPreviewDiagnostics(): void {
  navigations.length = 0;
  startedAt = Date.now();
}

export function toPathname(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname;
  } catch {
    return "(unparsable)";
  }
}

// documentは画面遷移、POSTはServer Actionの往復に対応する。この2種類が
// あれば「どの画面のどの操作がどのstatusで終わったか」を追える。
function isRecordable(method: string, resourceType: string): boolean {
  return resourceType === "document" || method === "POST";
}

export function watchPreviewNavigations(page: Page, label: string): void {
  page.on("response", (response) => {
    const request = response.request();
    const method = request.method();
    if (!isRecordable(method, request.resourceType())) return;
    navigations.push({
      elapsedMs: Date.now() - startedAt,
      label,
      method,
      pathname: toPathname(response.url()),
      status: response.status(),
    });
  });
}

export function formatPreviewDiagnostics(): string[] {
  return navigations.map(
    (record) =>
      `[e2e] +${(record.elapsedMs / 1000).toFixed(1)}s ${record.label} ` +
      `${record.method} ${record.pathname} -> ${String(record.status)}`,
  );
}

export function reportPreviewDiagnostics(testInfo: TestInfo): void {
  if (testInfo.status === testInfo.expectedStatus) return;
  const lines = formatPreviewDiagnostics();
  console.log("[e2e] 失敗時の通信履歴(pathnameとstatusのみ、秘密情報は含めない)");
  if (lines.length === 0) {
    console.log("[e2e] 記録された通信はない");
    return;
  }
  for (const line of lines) console.log(line);
}

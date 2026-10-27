import { setTimeout } from "node:timers/promises";
import type { Page } from "@playwright/test";

// 入力値の即時更新や登録前にも一致するURLを、保存完了と取り違えない。
export async function runServerAction(page: Page, action: () => Promise<unknown>) {
  const actionUrl = page.url();
  const pendingResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url() === actionUrl);
  await action();
  // Server Actionは実行を終えてから応答ヘッダーを返すため、statusで保存結果を判定できる。
  // 応答本文のストリームは開いたまま残ることがあり(ビルド済みWorker、Next.js 16.4以降の
  // next dev)、Playwrightのresponse.finished()はその場合に解決しないので待たない。
  const response = await pendingResponse;
  if (response.status() >= 400) throw new Error(`Server Action failed: ${String(response.status())}`);
}

export async function delayActionRequest(page: Page, pathname: string) {
  await page.route((url) => url.pathname === pathname, async (route) => {
    if (route.request().method() === "POST") await setTimeout(200);
    await route.continue();
  });
}

import {
  PRODUCTION_SMOKE_CHECKS,
  type SmokeResponse,
} from "./cloudflare-smoke-contract.ts";
import { runSmokeCheckWithRetry } from "./cloudflare-smoke-check.ts";

function parseBaseUrl(value: string | undefined): URL {
  if (value === undefined) throw new Error("公開HTTPS URLを指定してください。");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error("queryや認証情報を含まない公開HTTPS URLを指定してください。");
  }
  url.pathname = "/";
  return url;
}

async function fetchSmokeResponse(url: URL): Promise<SmokeResponse> {
  const response = await fetch(url, { redirect: "manual" });
  const contentType = response.headers.get("content-type");
  const body = contentType?.toLowerCase().includes("text/") === true ||
    contentType?.toLowerCase().includes("json") === true
    ? await response.text()
    : "";
  return {
    body,
    contentType,
    location: response.headers.get("location"),
    status: response.status,
  };
}

async function main(): Promise<void> {
  const baseUrl = parseBaseUrl(process.argv[2]);
  for (const check of PRODUCTION_SMOKE_CHECKS) {
    const url = new URL(check.pathname, baseUrl);
    await runSmokeCheckWithRetry(check, () => fetchSmokeResponse(url), undefined, {
      onRetry: ({ attempt, maxAttempts, pathname, reason }) => {
        process.stderr.write(
          `retry ${String(attempt)}/${String(maxAttempts)} ${pathname}: ${reason}\n`,
        );
      },
    });
    process.stdout.write(`OK ${check.pathname}\n`);
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "公開環境の確認に失敗しました。";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

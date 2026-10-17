import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

import { parseAllowedDevOrigins } from "./src/lib/dev-origins";
import { loadAppVersionBuildInfo } from "./scripts/app-version-build";

// next devでもWorkerと同じD1 bindingを取得する。初期化はOpenNext側が
// 必要なプロセスだけで一度行うため、通常のNext開発では副作用を持たない。
void initOpenNextCloudflareForDev();

const appVersionInfo = loadAppVersionBuildInfo();

// 外部サービス連携の同意・解除の画面を他サイトのframeへ埋め込ませない。
// 透明なframeで「許可する」を押させるclickjackingを防ぐ(Issue #436)。
const FRAME_DENY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  // プロジェクト固有のAGENTS.mdをNext.jsが自動変更しないようにします。
  agentRules: false,
  // スマートフォンでの試用時に、開発ツールがYAMORUの通知と重ならないようにします。
  devIndicators: false,
  // LAN内の端末で開いた場合にも、Next.jsの開発用JavaScriptを読み込めるようにします。
  allowedDevOrigins: parseAllowedDevOrigins(process.env.YAMORU_ALLOWED_DEV_ORIGINS),
  // 検証済みの公開用情報だけをクライアントへ埋め込む。完全な環境設定やSecretは
  // この経路へ渡さない(Issue #221)。
  env: {
    NEXT_PUBLIC_YAMORU_BUILD_ID: appVersionInfo.buildId,
    NEXT_PUBLIC_YAMORU_ENVIRONMENT: appVersionInfo.environment,
    NEXT_PUBLIC_YAMORU_VERSION: appVersionInfo.version,
  },
  headers() {
    return Promise.resolve([
      { headers: FRAME_DENY_HEADERS, source: "/oauth/:path*" },
      { headers: FRAME_DENY_HEADERS, source: "/settings/integrations" },
    ]);
  },
};

export default nextConfig;

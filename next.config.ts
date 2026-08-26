import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

import { parseAllowedDevOrigins } from "./src/lib/dev-origins";
import { loadAppVersionBuildInfo } from "./scripts/app-version-build";

// next devでもWorkerと同じD1 bindingを取得する。初期化はOpenNext側が
// 必要なプロセスだけで一度行うため、通常のNext開発では副作用を持たない。
void initOpenNextCloudflareForDev();

const appVersionInfo = loadAppVersionBuildInfo();

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
};

export default nextConfig;

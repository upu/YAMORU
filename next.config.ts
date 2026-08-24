import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

import { parseAllowedDevOrigins } from "./src/lib/dev-origins";

// next devでもWorkerと同じD1 bindingを取得する。初期化はOpenNext側が
// 必要なプロセスだけで一度行うため、通常のNext開発では副作用を持たない。
void initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  // プロジェクト固有のAGENTS.mdをNext.jsが自動変更しないようにします。
  agentRules: false,
  // スマートフォンでの試用時に、開発ツールがYAMORUの通知と重ならないようにします。
  devIndicators: false,
  // LAN内の端末で開いた場合にも、Next.jsの開発用JavaScriptを読み込めるようにします。
  allowedDevOrigins: parseAllowedDevOrigins(process.env.YAMORU_ALLOWED_DEV_ORIGINS),
};

export default nextConfig;

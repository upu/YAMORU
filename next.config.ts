import type { NextConfig } from "next";

import { parseAllowedDevOrigins } from "./lib/dev-origins";

const nextConfig: NextConfig = {
  // プロジェクト固有のAGENTS.mdをNext.jsが自動変更しないようにします。
  agentRules: false,
  // スマートフォンでの試用時に、開発ツールがYAMORUの通知と重ならないようにします。
  devIndicators: false,
  // LAN内の端末で開いた場合にも、Next.jsの開発用JavaScriptを読み込めるようにします。
  allowedDevOrigins: parseAllowedDevOrigins(process.env.YAMORU_ALLOWED_DEV_ORIGINS),
};

export default nextConfig;

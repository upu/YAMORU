import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // プロジェクト固有のAGENTS.mdをNext.jsが自動変更しないようにします。
  agentRules: false,
  // スマートフォンでの試用時に、開発ツールがYAMORUの通知と重ならないようにします。
  devIndicators: false,
};

export default nextConfig;

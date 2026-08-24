import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      // configPathとtest.includeは、この設定ファイルの位置ではなく
      // 実行時のcwd(リポジトリルート)を基準に解決される。
      wrangler: { configPath: "./config/wrangler/d1-test.jsonc" },
    }),
  ],
  test: {
    include: ["src/lib/d1/**/*.d1-test.ts"],
  },
});

// Issue #116スパイク: D1バインディングを使ったhousehold認可ロジックを
// 実際のWorkersランタイム(Miniflare)上でテストするための専用設定。
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["lib/d1-spike/**/*.spike.test.ts"],
  },
});

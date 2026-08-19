import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    exclude: [
      ...configDefaults.exclude,
      ".claude/worktrees/**",
      "tests/**/*.integration.test.ts",
      // Issue #116スパイク: Workersランタイム(D1バインディング)が必要なため、
      // vitest.d1-spike.config.ts(npm run spike:cf:d1:test)側だけで実行する。
      "lib/d1-spike/**/*.spike.test.ts",
    ],
  },
});

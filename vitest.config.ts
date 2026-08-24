import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    exclude: [
      ...configDefaults.exclude,
      ".claude/worktrees/**",
      "e2e/**",
      "tests/**/*.integration.test.ts",
      // Workersランタイム(D1バインディング)が必要なため、
      // config/vitest.d1.config.ts(npm run test:d1)側だけで実行する。
      "src/lib/d1/**/*.d1-test.ts",
    ],
  },
});

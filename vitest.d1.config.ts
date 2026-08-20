import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.d1-test.jsonc" },
    }),
  ],
  test: {
    include: ["lib/d1/**/*.d1-test.ts"],
  },
});

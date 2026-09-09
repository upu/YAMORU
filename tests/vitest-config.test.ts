import { describe, expect, it } from "vitest";

import vitestConfig from "../vitest.config";

describe("Vitestのテスト探索範囲", () => {
  it("別checkoutのworktreeをmainのテストへ混ぜない", () => {
    expect(vitestConfig).toHaveProperty("test.exclude");
    const exclude = (vitestConfig as { test: { exclude: string[] } }).test.exclude;

    expect(exclude).toContain(".worktrees/**");
    expect(exclude).toContain(".claude/worktrees/**");
  });
});

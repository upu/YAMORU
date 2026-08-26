import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const styles = readFileSync(
  join(process.cwd(), "src", "app", "globals.css"),
  "utf8",
);

describe("共通の追加ボタンの配置(Issue #215)", () => {
  it("PCでは画面右下へ固定する", () => {
    expect(styles).toMatch(
      /\.floating-add-button\s*\{[\s\S]*?position:\s*fixed[\s\S]*?right:[^;]+;[\s\S]*?bottom:\s*24px/u,
    );
  });

  it("モバイルでは下部ナビゲーションの上へ配置する", () => {
    expect(styles).toMatch(
      /@media \(max-width: 480px\)[\s\S]*?\.floating-add-button\s*\{[\s\S]*?bottom:\s*calc\(var\(--mobile-nav-height\) \+ 16px\)/u,
    );
  });
});

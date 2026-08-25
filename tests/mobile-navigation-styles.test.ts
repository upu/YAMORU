import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const styles = readFileSync(
  join(process.cwd(), "src", "app", "globals.css"),
  "utf8",
);

describe("モバイル下部ナビゲーションのレイアウト(Issue #213)", () => {
  it("3項目を等幅で並べ、ホーム内の重複するTodo一覧導線を隠す", () => {
    expect(styles).toMatch(
      /\.mobile-bottom-navigation\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/u,
    );
    expect(styles).toMatch(
      /\.home-todo-list-link\s*\{[^}]*display:\s*none/u,
    );
  });

  it("safe areaを含む高さを本文余白と共有する", () => {
    expect(styles).toContain(
      "--mobile-nav-height: calc(72px + env(safe-area-inset-bottom));",
    );
    expect(styles).toMatch(
      /\.mobile-bottom-navigation-space\s*\{[\s\S]*?height:\s*var\(--mobile-nav-height\)/u,
    );
  });
});

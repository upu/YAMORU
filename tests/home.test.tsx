import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import Home from "../app/page";
import { DemoStateProvider } from "../app/demo-state";
import { HOME_SECTIONS } from "../app/home-data";

afterEach(cleanup);

function renderHome() {
  return render(<DemoStateProvider><Home /></DemoStateProvider>);
}

describe("ホーム画面", () => {
  it("YAMORUの名前とタグラインを表示する", () => {
    renderHome();

    expect(
      screen.getByRole("heading", { level: 1, name: "YAMORU" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("暮らしの「いつだっけ？」をなくす。"),
    ).toBeInTheDocument();
  });

  it.each(["期限切れ", "今日", "近日", "最近の実施"])(
    "%sの区分を見分けられる",
    (sectionTitle) => {
      renderHome();

      const section = screen.getByRole("region", { name: sectionTitle });
      expect(
        within(section).getByRole("heading", {
          level: 2,
          name: sectionTitle,
        }),
      ).toBeInTheDocument();
    },
  );

  it("猫の浄水器のフィルター交換の期限または実施を表示する", () => {
    renderHome();

    expect(
      screen.getAllByText("猫の浄水器のフィルター交換").length,
    ).toBeGreaterThan(0);
  });

  it("猫の浄水器に関係する表示から管理対象の詳細へ移動できる", () => {
    renderHome();

    const detailLinks = screen.getAllByRole("link", {
      name: "猫の浄水器のフィルター交換",
    });

    expect(detailLinks.length).toBeGreaterThan(0);
    expect(
      detailLinks.every(
        (link) =>
          link.getAttribute("href") ===
          "/managed-items/cat-water-fountain",
      ),
    ).toBe(true);
  });

  it("外部サービスに依存しない固定サンプルを4区分に持つ", () => {
    expect(HOME_SECTIONS).toHaveLength(4);
    expect(HOME_SECTIONS.every((section) => section.items.length > 0)).toBe(
      true,
    );
  });
});

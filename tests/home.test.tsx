import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import Home from "../app/page";
import { HOME_SECTIONS } from "../app/home-data";

afterEach(cleanup);

describe("ホーム画面", () => {
  it("YAMORUの名前とタグラインを表示する", () => {
    render(<Home />);

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
      render(<Home />);

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
    render(<Home />);

    expect(
      screen.getAllByText("猫の浄水器のフィルター交換").length,
    ).toBeGreaterThan(0);
  });

  it("外部サービスに依存しない固定サンプルを4区分に持つ", () => {
    expect(HOME_SECTIONS).toHaveLength(4);
    expect(HOME_SECTIONS.every((section) => section.items.length > 0)).toBe(
      true,
    );
  });
});

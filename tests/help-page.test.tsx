import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HelpContent } from "../src/app/help/page";

afterEach(cleanup);

const VERSION_INFO = {
  buildId: "e174985",
  environment: "preview" as const,
  version: "0.8.0",
};

describe("ヘルプの使い方(Issue #361)", () => {
  it("YAMORUで扱う主なものを確認できる", () => {
    render(<HelpContent versionInfo={VERSION_INFO} />);

    const usage = screen.getByRole("region", { name: "YAMORUの使い方" });
    for (const term of ["Todo", "台帳", "消耗品"]) {
      expect(within(usage).getByText(term)).toBeInTheDocument();
    }
    expect(within(usage).getByRole("heading", { name: "日常的な操作" }))
      .toBeInTheDocument();
  });

  it("アイコンだけの操作の意味を、ピン留めを含めて確認できる", () => {
    render(<HelpContent versionInfo={VERSION_INFO} />);

    const icons = screen.getByRole("region", { name: "主なアイコン" });
    const pin = within(icons).getByText("ピン留め");
    expect(pin.querySelector("svg")).toBeInTheDocument();
    expect(within(icons).getByText(/ホームのピン留めに追加します/u))
      .toBeInTheDocument();
    expect(within(icons).getByText("追加")).toBeInTheDocument();
    expect(within(icons).getByText("編集")).toBeInTheDocument();
  });

  it("使い方を足しても、問い合わせ用のバージョン情報を残す", () => {
    render(<HelpContent versionInfo={VERSION_INFO} />);

    const version = screen.getByRole("region", { name: "バージョン情報" });
    expect(within(version).getByText("YAMORU 0.8.0 · preview · e174985"))
      .toBeInTheDocument();
  });
});

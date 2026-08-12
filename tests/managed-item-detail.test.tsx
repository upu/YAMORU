import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ManagedItemDetail from "../app/managed-items/cat-water-fountain/page";
import { DemoStateProvider } from "../app/demo-state";
import { CAT_WATER_FOUNTAIN } from "../app/managed-items/cat-water-fountain/sample-data";

afterEach(cleanup);

function renderManagedItemDetail() {
  return render(<DemoStateProvider><ManagedItemDetail /></DemoStateProvider>);
}

describe("猫の浄水器の管理対象詳細", () => {
  it("管理対象の名前、種類、前回の実施者と実施日を上部に表示する", () => {
    renderManagedItemDetail();

    expect(
      screen.getByRole("heading", { level: 1, name: "猫の浄水器" }),
    ).toBeInTheDocument();
    expect(screen.getByText("ペット用品")).toBeInTheDocument();

    const lastActivity = screen.getByRole("region", {
      name: "最後のフィルター交換",
    });
    expect(within(lastActivity).getByText("7月10日")).toBeInTheDocument();
    expect(within(lastActivity).getByText("家族A")).toBeInTheDocument();
  });

  it("次回期限と関連するフィルター交換Todoを表示する", () => {
    renderManagedItemDetail();

    const relatedTodo = screen.getByRole("region", { name: "関連するTodo" });
    expect(within(relatedTodo).getByText("フィルター交換")).toBeInTheDocument();
    expect(within(relatedTodo).getByText("8月9日まで")).toBeInTheDocument();
    expect(within(relatedTodo).getByText("期限切れ")).toBeInTheDocument();
  });

  it("安全なサンプル外部リンクを表示する", () => {
    renderManagedItemDetail();

    const externalLink = screen.getByRole("link", {
      name: "サンプル商品ページを開く",
    });
    expect(externalLink).toHaveAttribute(
      "href",
      "https://example.com/cat-water-fountain",
    );
    expect(externalLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(CAT_WATER_FOUNTAIN.externalLink).toMatchObject({
      isSample: true,
      url: "https://example.com/cat-water-fountain",
    });
  });

  it("最近の実施履歴を表示する", () => {
    renderManagedItemDetail();

    const history = screen.getByRole("region", { name: "最近の実施履歴" });
    expect(within(history).getByText("7月10日")).toBeInTheDocument();
    expect(within(history).getByText("6月10日")).toBeInTheDocument();
    expect(within(history).getAllByText("家族A")).toHaveLength(2);
    expect(within(history).getByText("家族B")).toBeInTheDocument();
  });

  it("ホーム画面へ戻れる", () => {
    renderManagedItemDetail();

    expect(
      screen.getByRole("navigation", { name: "ページ移動" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ホームへ戻る/ })).toHaveAttribute(
      "href",
      "/",
    );
  });
});

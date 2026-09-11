import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/app/consumables/stock-actions", () => ({
  updateConsumableStockStatus: vi.fn(),
}));

import { ShoppingCandidatesSection } from "../src/app/shopping-candidates";
import { StockStatusControl } from "../src/app/consumables/stock-status-control";

afterEach(cleanup);

describe("消耗品の在庫状態", () => {
  it("数量入力なしで、ある・少ない・ないを可逆に選べる", () => {
    render(<StockStatusControl consumableId="consumable-1" stockStatus="low" />);

    // Issue #395: 在庫の変更と補充を1枚のカードへまとめた。
    const region = screen.getByRole("region", { name: "在庫と補充" });
    expect(within(region).getByText("現在: 少ない")).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "ある" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(within(region).getByRole("button", { name: "少ない" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(within(region).getByRole("button", { name: "ない" }))
      .toHaveAttribute("aria-pressed", "false");
    const lowButton = within(region).getByRole("button", { name: "少ない" });
    expect(lowButton).toHaveTextContent(/^少ない$/u);
    expect(lowButton.querySelector("svg")).not.toBeInTheDocument();
    expect(within(region).queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(within(region).queryByText("買って補充したら「ある」に戻します。"))
      .not.toBeInTheDocument();
  });
});

describe("ホームの買い物候補", () => {
  it("少ない・ないをTodoとは別の確認専用セクションに表示する", () => {
    render(<ShoppingCandidatesSection candidates={[
      { id: "paper", name: "トイレットペーパー", stockStatus: "low" },
      { id: "filter", name: "交換フィルター", stockStatus: "out" },
    ]} />);

    const region = screen.getByRole("region", { name: "買っておきたいもの" });
    expect(within(region).getByRole("link", { name: "トイレットペーパー" }))
      .toHaveAttribute("href", "/consumables/paper");
    expect(within(region).getByText("少ない")).toBeInTheDocument();
    expect(within(region).getByText("ない")).toBeInTheDocument();
    expect(within(region).queryByRole("button")).not.toBeInTheDocument();
  });

  // Issue #398: ホームは素早く確認する画面なので、買い物候補もピン留めと
  // 同じ密度の一覧にする。1件ずつの枠と、毎回読む必要のない説明文は置かない。
  it("説明文を置かず、名前と在庫状態だけを1行ずつ並べる", () => {
    render(<ShoppingCandidatesSection candidates={[
      { id: "paper", name: "トイレットペーパー", stockStatus: "low" },
      { id: "filter", name: "交換フィルター", stockStatus: "out" },
    ]} />);

    const region = screen.getByRole("region", { name: "買っておきたいもの" });
    // 「少ない」「ない」のバッジが同じことを示すため、説明文は繰り返さない。
    expect(within(region).queryByText("残りが少ない、または切れている消耗品です"))
      .not.toBeInTheDocument();

    const items = within(region).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    for (const [item, name, stock] of [
      [items[0], "トイレットペーパー", "少ない"],
      [items[1], "交換フィルター", "ない"],
    ] as const) {
      expect(within(item).getByRole("link", { name })).toBeInTheDocument();
      expect(within(item).getByText(stock)).toBeInTheDocument();
    }
  });

  it("1件でも同じ形で表示する", () => {
    render(<ShoppingCandidatesSection candidates={[
      { id: "paper", name: "トイレットペーパー", stockStatus: "low" },
    ]} />);

    const region = screen.getByRole("region", { name: "買っておきたいもの" });
    expect(within(region).getAllByRole("listitem")).toHaveLength(1);
    expect(within(region).getByLabelText("1件")).toHaveTextContent("1");
  });
});

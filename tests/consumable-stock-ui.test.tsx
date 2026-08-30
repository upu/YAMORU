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

    const region = screen.getByRole("region", { name: "在庫" });
    expect(within(region).getByText("現在: 少ない")).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "ある" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(within(region).getByRole("button", { name: "少ない" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(within(region).getByRole("button", { name: "ない" }))
      .toHaveAttribute("aria-pressed", "false");
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
});

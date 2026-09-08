import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/app/consumables/stock-actions", () => ({
  updateConsumableStockStatus: vi.fn(),
}));
vi.mock("../src/app/consumables/favorite-actions", () => ({
  updateConsumableFavorite: vi.fn(),
}));

import { FavoriteConsumablesSection } from "../src/app/favorite-consumables";
import { FavoriteToggle } from "../src/app/consumables/favorite-toggle";

afterEach(cleanup);

const FAVORITES = Array.from({ length: 6 }, (_, index) => ({
  id: `consumable-${String(index + 1)}`,
  name: `お気に入り${String(index + 1)}`,
  stockStatus: index % 2 === 0 ? "available" as const : "low" as const,
}));

describe("ホームのお気に入り消耗品", () => {
  it("5件以下は全件を表示し、折りたたみ操作を出さない", () => {
    render(<FavoriteConsumablesSection favorites={FAVORITES.slice(0, 5)} />);

    const region = screen.getByRole("region", { name: "お気に入り" });
    expect(within(region).getAllByRole("article")).toHaveLength(5);
    expect(within(region).queryByRole("button", { name: /ほか.*件を表示/u }))
      .not.toBeInTheDocument();
  });

  it("6件以上は最近の5件を表示し、残りを展開して閉じられる", () => {
    render(<FavoriteConsumablesSection favorites={FAVORITES} />);

    const region = screen.getByRole("region", { name: "お気に入り" });
    expect(within(region).getAllByRole("article")).toHaveLength(5);
    expect(within(region).queryByText("お気に入り6")).not.toBeInTheDocument();

    fireEvent.click(within(region).getByRole("button", { name: "ほか1件を表示" }));
    expect(within(region).getAllByRole("article")).toHaveLength(6);
    expect(within(region).getByText("お気に入り6")).toBeInTheDocument();

    fireEvent.click(within(region).getByRole("button", { name: "閉じる" }));
    expect(within(region).getAllByRole("article")).toHaveLength(5);
    expect(within(region).queryByText("お気に入り6")).not.toBeInTheDocument();
  });

  it("各消耗品の詳細へ移動でき、家庭共有の在庫状態をその場で変更できる", () => {
    render(<FavoriteConsumablesSection favorites={[FAVORITES[0]]} />);

    const item = screen.getByRole("article", { name: "お気に入り1" });
    expect(within(item).getByRole("link", { name: "お気に入り1" }))
      .toHaveAttribute("href", "/consumables/consumable-1");
    expect(within(item).getByRole("group", { name: "お気に入り1の在庫状態を変更" }))
      .toBeInTheDocument();
    expect(within(item).getByRole("button", { name: "ある" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("現在の在庫状態を状態変更ボタンだけで示し、独立したバッジを重ねない", () => {
    render(<FavoriteConsumablesSection favorites={[FAVORITES[1]]} />);

    const item = screen.getByRole("article", { name: "お気に入り2" });
    expect(item.querySelector(".stock-status-badge")).not.toBeInTheDocument();
    expect(within(item).getAllByText("少ない")).toHaveLength(1);
    expect(within(item).getByRole("button", { name: "少ない" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(within(item).getByRole("button", { name: "ある" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(within(item).getByRole("button", { name: "ない" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("表示密度を優先し、セクションに説明文を置かない", () => {
    render(<FavoriteConsumablesSection favorites={FAVORITES.slice(0, 1)} />);

    const region = screen.getByRole("region", { name: "お気に入り" });
    expect(within(region).getByRole("heading", { name: "お気に入り" }))
      .toBeInTheDocument();
    expect(region.querySelector(".section-heading p")).not.toBeInTheDocument();
  });
});

describe("消耗品詳細のお気に入り操作", () => {
  it("個人のお気に入りへ追加・解除する可逆な操作を示す", () => {
    const { rerender } = render(
      <FavoriteToggle consumableId="consumable-1" isFavorite={false} />,
    );
    expect(screen.getByRole("button", { name: "お気に入りに追加" }))
      .toHaveAttribute("aria-pressed", "false");

    rerender(<FavoriteToggle consumableId="consumable-1" isFavorite />);
    expect(screen.getByRole("button", { name: "お気に入りから外す" }))
      .toHaveAttribute("aria-pressed", "true");
  });
});

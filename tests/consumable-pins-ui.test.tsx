import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/app/consumables/stock-actions", () => ({
  updateConsumableStockStatus: vi.fn(),
}));
vi.mock("../src/app/consumables/pin-actions", () => ({
  updateConsumablePin: vi.fn(() => ({ message: "", status: "idle" })),
}));

import { PinnedConsumablesSection } from "../src/app/pinned-consumables";
import { PinToggle } from "../src/app/consumables/pin-toggle";

afterEach(cleanup);

const PINS = Array.from({ length: 6 }, (_, index) => ({
  id: `consumable-${String(index + 1)}`,
  name: `ピン留め${String(index + 1)}`,
  stockStatus: index % 2 === 0 ? "available" as const : "low" as const,
}));

describe("ホームのピン留め消耗品", () => {
  it("5件以下は全件を表示し、折りたたみ操作を出さない", () => {
    render(<PinnedConsumablesSection pins={PINS.slice(0, 5)} />);

    const region = screen.getByRole("region", { name: "ピン留め" });
    expect(within(region).getAllByRole("article")).toHaveLength(5);
    expect(within(region).queryByRole("button", { name: /ほか.*件を表示/u }))
      .not.toBeInTheDocument();
  });

  it("6件以上は最近の5件を表示し、残りを展開して閉じられる", () => {
    render(<PinnedConsumablesSection pins={PINS} />);

    const region = screen.getByRole("region", { name: "ピン留め" });
    expect(within(region).getAllByRole("article")).toHaveLength(5);
    expect(within(region).queryByText("ピン留め6")).not.toBeInTheDocument();

    fireEvent.click(within(region).getByRole("button", { name: "ほか1件を表示" }));
    expect(within(region).getAllByRole("article")).toHaveLength(6);
    expect(within(region).getByText("ピン留め6")).toBeInTheDocument();

    fireEvent.click(within(region).getByRole("button", { name: "閉じる" }));
    expect(within(region).getAllByRole("article")).toHaveLength(5);
    expect(within(region).queryByText("ピン留め6")).not.toBeInTheDocument();
  });

  it("各消耗品の詳細へ移動でき、家庭共有の在庫状態をその場で変更できる", () => {
    render(<PinnedConsumablesSection pins={[PINS[0]]} />);

    const item = screen.getByRole("article", { name: "ピン留め1" });
    expect(within(item).getByRole("link", { name: "ピン留め1" }))
      .toHaveAttribute("href", "/consumables/consumable-1");
    expect(within(item).getByRole("group", { name: "ピン留め1の在庫状態を変更" }))
      .toBeInTheDocument();
    expect(within(item).getByRole("button", { name: "ある" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("現在の在庫状態を状態変更ボタンだけで示し、独立したバッジを重ねない", () => {
    render(<PinnedConsumablesSection pins={[PINS[1]]} />);

    const item = screen.getByRole("article", { name: "ピン留め2" });
    expect(item.querySelector(".stock-status-badge")).not.toBeInTheDocument();
    expect(within(item).getAllByText("少ない")).toHaveLength(1);
    expect(within(item).getByRole("button", { name: "少ない" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(within(item).getByRole("button", { name: "ある" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(within(item).getByRole("button", { name: "ない" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("状態変更ボタンを○△×のアイコンで表示し、読み上げ用の語は残す", () => {
    render(<PinnedConsumablesSection pins={[PINS[1]]} />);

    const item = screen.getByRole("article", { name: "ピン留め2" });
    const low = within(item).getByRole("button", { name: "少ない" });
    expect(low.querySelector("svg")).toBeInTheDocument();
    expect(low).toHaveTextContent(/^少ない$/u);
    expect(low).toHaveAttribute("aria-pressed", "true");
  });

  it("選択中の色を状態ごとに変えられるよう、状態別のクラスを付ける", () => {
    render(<PinnedConsumablesSection pins={[PINS[1]]} />);

    const item = screen.getByRole("article", { name: "ピン留め2" });
    expect(within(item).getByRole("button", { name: "ある" }))
      .toHaveClass("stock-status-option-available");
    expect(within(item).getByRole("button", { name: "少ない" }))
      .toHaveClass("stock-status-option-low");
    expect(within(item).getByRole("button", { name: "ない" }))
      .toHaveClass("stock-status-option-out");
  });

  it("表示密度を優先し、セクションに説明文を置かない", () => {
    render(<PinnedConsumablesSection pins={PINS.slice(0, 1)} />);

    const region = screen.getByRole("region", { name: "ピン留め" });
    expect(within(region).getByRole("heading", { name: "ピン留め" }))
      .toBeInTheDocument();
    expect(region.querySelector(".section-heading p")).not.toBeInTheDocument();
  });
});

describe("消耗品詳細のピン留め操作(Issue #361)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("説明文を常時出さず、アイコンだけのボタンで可逆な操作を示す", () => {
    const { rerender } = render(
      <PinToggle consumableId="consumable-1" isPinned={false} />,
    );

    const addButton = screen.getByRole("button", { name: "ホームにピン留め" });
    expect(addButton).toHaveAttribute("aria-pressed", "false");
    expect(addButton.querySelector("svg")).toBeInTheDocument();
    // 見えている語はなく、読み上げ用の語だけを残す。
    expect(addButton).toHaveTextContent(/^ホームにピン留め$/u);
    expect(addButton.querySelector("span")).toHaveClass("sr-only");

    rerender(<PinToggle consumableId="consumable-1" isPinned />);
    const removeButton = screen.getByRole("button", { name: "ピン留めを外す" });
    expect(removeButton).toHaveAttribute("aria-pressed", "true");
    expect(removeButton).toHaveTextContent(/^ピン留めを外す$/u);
  });

  it("初めて見るときだけ、操作の意味を補う短いヒントを添える", () => {
    render(<PinToggle consumableId="consumable-1" isPinned={false} />);

    const hint = screen.getByText(
      "よく使う消耗品をピン留めすると、ホームからすぐ確認・操作できます。",
    );
    expect(hint).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ホームにピン留め" }))
      .toHaveAttribute("aria-describedby", hint.parentElement?.id ?? "");
  });

  it("閉じたヒントは、開き直しても繰り返し表示しない", () => {
    render(<PinToggle consumableId="consumable-1" isPinned={false} />);

    fireEvent.click(screen.getByRole("button", { name: "ヒントを閉じる" }));
    expect(screen.queryByText(/よく使う消耗品をピン留めすると/u))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ホームにピン留め" }))
      .not.toHaveAttribute("aria-describedby");

    cleanup();
    render(<PinToggle consumableId="consumable-1" isPinned={false} />);
    expect(screen.queryByText(/よく使う消耗品をピン留めすると/u))
      .not.toBeInTheDocument();
  });

  it("既読を記録できない環境では、繰り返さないためヒントを出さない", async () => {
    // localStorageを読めても書けない環境(容量制限・プライバシー設定)を再現する。
    vi.resetModules();
    const setItem = vi.spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("書き込みできません");
      });
    try {
      const { PinToggle: FreshPinToggle } = await import(
        "../src/app/consumables/pin-toggle"
      );
      render(<FreshPinToggle consumableId="consumable-1" isPinned={false} />);

      expect(screen.getByRole("button", { name: "ホームにピン留め" }))
        .toBeInTheDocument();
      expect(screen.queryByText(/よく使う消耗品をピン留めすると/u))
        .not.toBeInTheDocument();
    } finally {
      setItem.mockRestore();
      vi.resetModules();
    }
  });

  it("ピン留めを実際に操作したときも、ヒントを既読にする", () => {
    render(<PinToggle consumableId="consumable-1" isPinned={false} />);

    fireEvent.click(screen.getByRole("button", { name: "ホームにピン留め" }));
    expect(screen.queryByText(/よく使う消耗品をピン留めすると/u))
      .not.toBeInTheDocument();

    cleanup();
    render(<PinToggle consumableId="consumable-1" isPinned />);
    expect(screen.queryByText(/よく使う消耗品をピン留めすると/u))
      .not.toBeInTheDocument();
  });
});

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/app/consumables/refill-actions", () => ({
  recordConsumableRefill: vi.fn(),
}));

import { ConsumableRefillControl } from "../src/app/consumables/refill-control";

afterEach(cleanup);

describe("消耗品の補充記録", () => {
  it("日付入力なしで補充を記録でき、履歴を新しい順に表示する", () => {
    render(
      <ConsumableRefillControl
        consumableId="consumable-1"
        refills={[
          { id: "refill-new", recordedAt: "2026-09-02T01:00:00.000Z", refilledOn: "2026-09-02" },
          { id: "refill-old", recordedAt: "2026-08-20T01:00:00.000Z", refilledOn: "2026-08-20" },
        ]}
      />,
    );

    const region = screen.getByRole("region", { name: "補充" });
    expect(within(region).getByRole("button", { name: "補充した" })).toBeInTheDocument();
    expect(within(region).queryByLabelText("補充日")).not.toBeInTheDocument();
    expect(within(region).getByRole("heading", { level: 3, name: "補充履歴" }))
      .toBeInTheDocument();
    expect(within(region).getAllByRole("listitem").map((item) => item.textContent))
      .toEqual(["2026年9月2日", "2026年8月20日"]);
  });

  it("履歴がない場合も補充操作へ到達できる", () => {
    render(<ConsumableRefillControl consumableId="consumable-1" refills={[]} />);

    expect(screen.getByRole("button", { name: "補充した" })).toBeInTheDocument();
    expect(screen.getByText("補充履歴はありません。")).toBeInTheDocument();
  });
});

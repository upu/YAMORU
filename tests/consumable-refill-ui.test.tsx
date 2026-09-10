import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
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

    // Issue #395: 補充は在庫カードの中の一区画になり、専用のカードは持たない。
    expect(screen.getByRole("button", { name: "補充した" })).toBeInTheDocument();
    expect(screen.queryByLabelText("補充日")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "補充履歴" }))
      .toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent))
      .toEqual(["2026年9月2日", "2026年8月20日"]);
  });

  // Issue #395: 記録は「補充した」から増えるため、履歴がないうちは見出しごと
  // 出さない。
  it("履歴がない場合は履歴の見出しを出さず、補充操作だけを残す", () => {
    render(<ConsumableRefillControl consumableId="consumable-1" refills={[]} />);

    expect(screen.getByRole("button", { name: "補充した" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3, name: "補充履歴" }))
      .not.toBeInTheDocument();
    expect(screen.queryByText("補充履歴はありません。")).not.toBeInTheDocument();
  });
});

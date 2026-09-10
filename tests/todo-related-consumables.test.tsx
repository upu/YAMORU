import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { searchConsumablesMock, setTaskRuleRelationMock } = vi.hoisted(() => ({
  searchConsumablesMock: vi.fn(),
  setTaskRuleRelationMock: vi.fn(),
}));

vi.mock("../src/app/consumables/relation-actions", () => ({
  searchConsumables: searchConsumablesMock,
  setConsumableTaskRuleRelation: setTaskRuleRelationMock,
}));

import { RelatedConsumablesSection } from "../src/app/consumables/related-consumables";

afterEach(cleanup);

const CONSUMABLES = [
  { id: "filter", name: "交換フィルター", stockStatus: "available" as const },
  { id: "cleaner", name: "石灰除去剤", stockStatus: "low" as const },
];

function candidates(items = CONSUMABLES) {
  return { hasMore: false, items, status: "ok" as const };
}

function section() {
  return screen.getByRole("region", { name: "関連する消耗品" });
}

function renderEditable(consumables = CONSUMABLES.slice(0, 1)) {
  return render(
    <RelatedConsumablesSection consumables={consumables} taskRuleId="rule-1" />,
  );
}

// Issue #395: 期限のあるTodo(メンテナンス以外)は関連を持てないため、追加の
// 導線も渡されない。関連も増やす導線もないカードは、見出しだけの空カードに
// なるので出さない。
describe("関連も導線もない場合の関連する消耗品 (Issue #395)", () => {
  it("追加も解除もできず関連が0件なら、カードごと表示しない", () => {
    render(<RelatedConsumablesSection consumables={[]} />);

    expect(screen.queryByRole("region", { name: "関連する消耗品" }))
      .not.toBeInTheDocument();
  });

  it("追加できなくても関連があれば、確認と遷移のために表示する", () => {
    render(<RelatedConsumablesSection consumables={CONSUMABLES.slice(0, 1)} />);

    const readOnly = screen.getByRole("region", { name: "関連する消耗品" });
    expect(within(readOnly).getByRole("link", { name: "交換フィルター" }))
      .toHaveAttribute("href", "/consumables/filter");
    expect(within(readOnly).queryByRole("button", { name: "消耗品を追加" }))
      .not.toBeInTheDocument();
  });
});

describe("Todo詳細の関連する消耗品の編集 (Issue #328)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchConsumablesMock.mockResolvedValue(candidates());
    setTaskRuleRelationMock.mockResolvedValue({ status: "ok" });
  });

  it("見出しの＋から名前で検索して追加し、同じ詳細へ反映する", async () => {
    renderEditable([]);

    const trigger = within(section()).getByRole("button", { name: "消耗品を追加" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "消耗品を追加" });
    fireEvent.change(within(dialog).getByLabelText("消耗品を検索"), {
      target: { value: "石灰" },
    });
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: "石灰除去剤" }));

    await waitFor(() => {
      expect(setTaskRuleRelationMock).toHaveBeenCalledWith("cleaner", "rule-1", true);
    });
    expect(searchConsumablesMock).toHaveBeenLastCalledWith("石灰");

    fireEvent.click(within(dialog).getByRole("button", { name: "選択を終える" }));

    expect(within(section()).getByRole("link", { name: "石灰除去剤" }))
      .toHaveAttribute("href", "/consumables/cleaner");
    expect(within(section()).getByText("少ない"))
      .toHaveClass("stock-status-badge", "stock-status-low");
  });

  it("選択済みを重複追加せず、候補でも選択済みとして示す", async () => {
    renderEditable();

    fireEvent.click(within(section()).getByRole("button", { name: "消耗品を追加" }));
    const checkbox = await screen.findByRole("checkbox", { name: "交換フィルター" });

    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(setTaskRuleRelationMock).toHaveBeenCalledWith("filter", "rule-1", false);
    });
    expect(setTaskRuleRelationMock).not.toHaveBeenCalledWith("filter", "rule-1", true);
  });

  it("一覧の×で関連だけを解除し、別の関連と詳細への導線を残す", async () => {
    renderEditable();

    fireEvent.click(within(section()).getByRole(
      "button",
      { name: "交換フィルターを関連から外す" },
    ));

    await waitFor(() => {
      expect(setTaskRuleRelationMock).toHaveBeenCalledWith("filter", "rule-1", false);
    });
    // Issue #395: 空になったら行を置かず、件数だけを読み上げへ残す。
    expect(await within(section()).findByText("関連する消耗品は0件です。"))
      .toBeInTheDocument();
    expect(within(section()).queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("保存に失敗したら既存表示を変えず、同じカードで理由を伝える", async () => {
    setTaskRuleRelationMock.mockResolvedValue({
      message: "関連を更新できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    renderEditable();

    fireEvent.click(within(section()).getByRole(
      "button",
      { name: "交換フィルターを関連から外す" },
    ));

    expect(await within(section()).findByRole("alert")).toHaveTextContent(
      "関連を更新できませんでした。時間をおいて再度お試しください。",
    );
    expect(within(section()).getByRole("link", { name: "交換フィルター" }))
      .toBeInTheDocument();
  });

  it("検索欄へ焦点を移し、Escapeで閉じたら＋へ焦点を戻す", () => {
    renderEditable([]);

    const trigger = within(section()).getByRole("button", { name: "消耗品を追加" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "消耗品を追加" });

    expect(within(dialog).getByLabelText("消耗品を検索")).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

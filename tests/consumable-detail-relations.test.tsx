import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  searchManagedItemsMock,
  searchTaskRulesMock,
  setManagedItemRelationMock,
  setTaskRuleRelationMock,
} = vi.hoisted(() => ({
  searchManagedItemsMock: vi.fn(),
  searchTaskRulesMock: vi.fn(),
  setManagedItemRelationMock: vi.fn(),
  setTaskRuleRelationMock: vi.fn(),
}));

vi.mock("../src/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../src/app/consumables/relation-actions", () => ({
  searchConsumableManagedItems: searchManagedItemsMock,
  searchConsumableTaskRules: searchTaskRulesMock,
  setConsumableManagedItemRelation: setManagedItemRelationMock,
  setConsumableTaskRuleRelation: setTaskRuleRelationMock,
}));

import {
  ConsumableDetailContent,
  type ConsumableDetailData,
} from "../src/app/consumables/[id]/page";

afterEach(cleanup);

const MANAGED_ITEMS = [
  { id: "item-1", name: "猫の給水機" },
  { id: "item-2", name: "お風呂" },
];

const TASK_RULES = [
  { id: "rule-1", managedItemName: "猫の給水機", title: "フィルターを交換する" },
  { id: "rule-2", managedItemName: null, title: "防災用品を点検する" },
];

function candidates<T>(items: T[]) {
  return { hasMore: false, items, status: "ok" as const };
}

function detail(overrides: Partial<ConsumableDetailData> = {}): ConsumableDetailData {
  return {
    externalUrl: null,
    id: "consumable-1",
    managedItems: [],
    name: "交換フィルター",
    note: null,
    productCode: null,
    stockStatus: "available",
    taskRules: [],
    ...overrides,
  };
}

function relationSection(unit: string) {
  return screen.getByRole("region", { name: `関連する${unit}` });
}

function openPicker(unit: string) {
  fireEvent.click(within(relationSection(unit)).getByRole("button", { name: `${unit}を追加` }));
  return screen.getByRole("dialog", { name: `${unit}を追加` });
}

// Issue #311: 関連を確認している場所から、そのまま追加・解除できるようにする。
describe("消耗品詳細の関連編集 (Issue #311)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchManagedItemsMock.mockResolvedValue(candidates(MANAGED_ITEMS));
    searchTaskRulesMock.mockResolvedValue(candidates(TASK_RULES));
    setManagedItemRelationMock.mockResolvedValue({ status: "ok" });
    setTaskRuleRelationMock.mockResolvedValue({ status: "ok" });
  });

  it("関連する管理対象の見出しから候補を検索して追加し、その場で反映する", async () => {
    render(<ConsumableDetailContent consumable={detail()} />);

    expect(within(relationSection("管理対象")).getByText("関連する管理対象はありません。"))
      .toBeInTheDocument();

    const dialog = openPicker("管理対象");
    fireEvent.change(within(dialog).getByLabelText("管理対象を検索"), {
      target: { value: "給水" },
    });
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: "猫の給水機" }));

    await waitFor(() => {
      expect(setManagedItemRelationMock)
        .toHaveBeenCalledWith("consumable-1", "item-1", true);
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "選択を終える" }));

    expect(within(relationSection("管理対象")).getByRole("link", { name: "猫の給水機" }))
      .toHaveAttribute("href", "/managed-items/item-1");
    expect(searchManagedItemsMock).toHaveBeenLastCalledWith("給水");
  });

  it("関連するTodoを追加でき、候補は関連する管理対象を手掛かりに探す", async () => {
    render(<ConsumableDetailContent consumable={detail({ managedItems: [MANAGED_ITEMS[0]] })} />);

    const dialog = openPicker("Todo");
    fireEvent.click(await within(dialog).findByRole(
      "checkbox",
      { name: "フィルターを交換する（猫の給水機）" },
    ));

    await waitFor(() => {
      expect(setTaskRuleRelationMock).toHaveBeenCalledWith("consumable-1", "rule-1", true);
    });
    expect(searchTaskRulesMock).toHaveBeenCalledWith("", ["item-1"]);
    expect(await within(relationSection("Todo")).findByText("フィルターを交換する"))
      .toBeInTheDocument();
  });

  it("選択済みの関連は候補でも選択済みとして示し、重ねて追加しない", async () => {
    render(<ConsumableDetailContent consumable={detail({ managedItems: [MANAGED_ITEMS[0]] })} />);

    const dialog = openPicker("管理対象");

    expect(await within(dialog).findByRole("checkbox", { name: "猫の給水機" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "お風呂" })).not.toBeChecked();

    // 選択済みをもう一度押した場合は、追加ではなく解除として扱う。
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "猫の給水機" }));

    await waitFor(() => {
      expect(setManagedItemRelationMock)
        .toHaveBeenCalledWith("consumable-1", "item-1", false);
    });
    expect(setManagedItemRelationMock).toHaveBeenCalledTimes(1);
  });

  it("一覧の解除操作で関連だけを外し、消耗品自体の表示は残す", async () => {
    render(<ConsumableDetailContent consumable={detail({
      managedItems: [MANAGED_ITEMS[0]],
      taskRules: [{ ...TASK_RULES[0], nextOccurrence: null }],
    })} />);

    fireEvent.click(screen.getByRole("button", { name: "猫の給水機を関連から外す" }));

    await waitFor(() => {
      expect(setManagedItemRelationMock)
        .toHaveBeenCalledWith("consumable-1", "item-1", false);
    });
    expect(await within(relationSection("管理対象")).findByText("関連する管理対象はありません。"))
      .toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "フィルターを交換する（猫の給水機）を関連から外す" }),
    );

    expect(await within(relationSection("Todo")).findByText("関連するTodoはありません。"))
      .toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "交換フィルター" }))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: "消耗品を編集" })).toBeInTheDocument();
  });

  it("続けて追加したとき、保存の完了順が入れ替わっても取りこぼさない", async () => {
    const resolvers: ((result: { status: "ok" }) => void)[] = [];
    setManagedItemRelationMock.mockImplementation(
      () => new Promise<{ status: "ok" }>((resolve) => { resolvers.push(resolve); }),
    );
    render(<ConsumableDetailContent consumable={detail()} />);

    const dialog = openPicker("管理対象");
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: "猫の給水機" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "お風呂" }));

    await waitFor(() => { expect(resolvers).toHaveLength(2); });
    // 後から始めた保存が先に完了する。
    resolvers[1]({ status: "ok" });
    resolvers[0]({ status: "ok" });

    const section = relationSection("管理対象");
    expect(await within(section).findByRole("link", { name: "猫の給水機" })).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: "お風呂" })).toBeInTheDocument();
  });

  it("保存に失敗したら一覧を変えずに理由を伝える", async () => {
    setManagedItemRelationMock.mockResolvedValue({
      message: "関連を更新できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    render(<ConsumableDetailContent consumable={detail({ managedItems: [MANAGED_ITEMS[0]] })} />);

    fireEvent.click(screen.getByRole("button", { name: "猫の給水機を関連から外す" }));

    const section = relationSection("管理対象");
    expect(await within(section).findByRole("alert")).toHaveTextContent(
      "関連を更新できませんでした。時間をおいて再度お試しください。",
    );
    expect(within(section).getByRole("link", { name: "猫の給水機" })).toBeInTheDocument();
  });

  it("保存の呼び出し自体が失敗しても、同じカードで理由を伝える", async () => {
    setManagedItemRelationMock.mockRejectedValue(new Error("network"));
    render(<ConsumableDetailContent consumable={detail({ managedItems: [MANAGED_ITEMS[0]] })} />);

    fireEvent.click(screen.getByRole("button", { name: "猫の給水機を関連から外す" }));

    const section = relationSection("管理対象");
    expect(await within(section).findByRole("alert")).toHaveTextContent(
      "関連を更新できませんでした。時間をおいて再度お試しください。",
    );
    expect(within(section).getByRole("link", { name: "猫の給水機" })).toBeInTheDocument();
  });

  it("キーボードで追加ダイアログを開閉し、閉じたら＋へ焦点を戻す", () => {
    render(<ConsumableDetailContent consumable={detail()} />);

    const trigger = within(relationSection("Todo")).getByRole("button", { name: "Todoを追加" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Todoを追加" });

    expect(within(dialog).getByLabelText("Todoを検索")).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

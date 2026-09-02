import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { searchConsumableManagedItemsMock, searchConsumableTaskRulesMock } = vi.hoisted(() => ({
  searchConsumableManagedItemsMock: vi.fn(),
  searchConsumableTaskRulesMock: vi.fn(),
}));

vi.mock("../src/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../src/app/consumables/relation-actions", () => ({
  searchConsumableManagedItems: searchConsumableManagedItemsMock,
  searchConsumableTaskRules: searchConsumableTaskRulesMock,
}));

import { ConsumableForm } from "../src/app/consumables/consumable-form";

afterEach(cleanup);

const MANAGED_ITEMS = [
  { id: "item-1", name: "猫の給水機" },
  { id: "item-2", name: "お風呂" },
];

const TASK_RULES = [
  { id: "rule-1", managedItemName: "猫の給水機", title: "給水機を掃除する" },
  { id: "rule-2", managedItemName: null, title: "給水機を掃除する" },
];

function candidates<T>(items: T[], hasMore = false) {
  return { hasMore, items, status: "ok" as const };
}

function openPicker(unit: string) {
  fireEvent.click(screen.getByRole("button", { name: `＋ ${unit}を追加` }));
  return screen.getByRole("dialog", { name: `${unit}を追加` });
}

function selectedIds(fieldName: string): string[] {
  return [...document.querySelectorAll<HTMLInputElement>(`input[name="${fieldName}"]`)]
    .map((input) => input.value);
}

describe("消耗品フォームの関連付け (Issue #292)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchConsumableManagedItemsMock.mockResolvedValue(candidates(MANAGED_ITEMS));
    searchConsumableTaskRulesMock.mockResolvedValue(candidates(TASK_RULES));
  });

  it("未選択の候補を常時表示せず、選択済みだけをフォームに並べる", () => {
    render(<ConsumableForm mode="create" />);

    expect(screen.getByText("関連付けている管理対象はありません。")).toBeInTheDocument();
    expect(screen.getByText("関連付けているTodoはありません。")).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(searchConsumableManagedItemsMock).not.toHaveBeenCalled();
    expect(searchConsumableTaskRulesMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "＋ 管理対象を追加" })).toBeInTheDocument();
    expect(screen.getByText("どれにも関連付けず、家庭共通の消耗品として登録できます。"))
      .toBeInTheDocument();
  });

  it("管理対象を検索して複数選び、件数の確認と個別の解除ができる", async () => {
    render(<ConsumableForm mode="create" />);

    const dialog = openPicker("管理対象");
    fireEvent.change(within(dialog).getByLabelText("管理対象を検索"), {
      target: { value: "の" },
    });
    expect(await within(dialog).findByText("2件見つかりました。")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "猫の給水機" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "お風呂" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "選択を終える" }));

    expect(searchConsumableManagedItemsMock).toHaveBeenCalledWith("の");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "関連する管理対象（2件・任意）" }))
      .toBeInTheDocument();
    expect(selectedIds("managedItemIds")).toEqual(["item-1", "item-2"]);

    fireEvent.click(screen.getByRole("button", { name: "お風呂を関連から外す" }));

    expect(selectedIds("managedItemIds")).toEqual(["item-1"]);
    expect(screen.getByRole("group", { name: "関連する管理対象（1件・任意）" }))
      .toBeInTheDocument();
  });

  it("Todo候補は関連する管理対象名を添え、選択済みの管理対象を手掛かりに探せる", async () => {
    render(<ConsumableForm initialManagedItem={MANAGED_ITEMS[0]} mode="create" />);

    const dialog = openPicker("Todo");

    expect(await within(dialog).findByRole(
      "checkbox",
      { name: "給水機を掃除する（猫の給水機）" },
    )).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "給水機を掃除する" }))
      .toBeInTheDocument();
    expect(searchConsumableTaskRulesMock).toHaveBeenCalledWith("", ["item-1"]);

    fireEvent.change(within(dialog).getByLabelText("Todoを検索"), {
      target: { value: "掃除" },
    });

    await waitFor(() => {
      expect(searchConsumableTaskRulesMock).toHaveBeenLastCalledWith("掃除", ["item-1"]);
    });
  });

  it("管理対象詳細から進んだ初期選択を、登録フォームの選択済みとして引き継ぐ", () => {
    render(<ConsumableForm initialManagedItem={MANAGED_ITEMS[0]} mode="create" />);

    expect(screen.getByRole("group", { name: "関連する管理対象（1件・任意）" }))
      .toBeInTheDocument();
    expect(selectedIds("managedItemIds")).toEqual(["item-1"]);
  });

  it("Issue #311: 編集フォームは関連付けを扱わず、詳細画面へ案内する", () => {
    render(
      <ConsumableForm
        consumable={{
          externalUrl: null,
          id: "consumable-1",
          name: "交換フィルター",
          note: null,
          productCode: null,
        }}
        mode="edit"
      />,
    );

    expect(screen.queryByRole("button", { name: "＋ 管理対象を追加" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "＋ Todoを追加" })).not.toBeInTheDocument();
    expect(selectedIds("managedItemIds")).toEqual([]);
    expect(selectedIds("taskRuleIds")).toEqual([]);
    expect(screen.getByText("関連する管理対象・Todoは、消耗品の詳細画面から追加・解除できます。"))
      .toBeInTheDocument();
    expect(screen.getByLabelText("名前")).toHaveValue("交換フィルター");
  });

  it("候補が多い場合と0件の場合に、状況を読み上げ可能な案内で伝える", async () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      id: `item-many-${String(index)}`,
      name: `収納棚${String(index)}`,
    }));
    searchConsumableManagedItemsMock.mockResolvedValueOnce(candidates(many, true));
    render(<ConsumableForm mode="create" />);

    const dialog = openPicker("管理対象");
    const status = await within(dialog).findByText(/先頭の20件を表示しています/u);

    expect(status).toHaveAttribute("aria-live", "polite");
    expect(within(dialog).getByLabelText("管理対象を検索"))
      .toHaveAttribute("aria-describedby", status.id);

    searchConsumableManagedItemsMock.mockResolvedValue(candidates([]));
    fireEvent.change(within(dialog).getByLabelText("管理対象を検索"), {
      target: { value: "該当なし" },
    });

    expect(await within(dialog).findByText("一致する管理対象がありません。")).toBeInTheDocument();
    expect(within(dialog).queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("候補の取得に失敗したら理由を伝え、再試行できる", async () => {
    searchConsumableManagedItemsMock.mockResolvedValueOnce({
      message: "候補を取得できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    render(<ConsumableForm mode="create" />);

    const dialog = openPicker("管理対象");

    expect(await within(dialog).findByText(
      "候補を取得できませんでした。時間をおいて再度お試しください。",
    )).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "再試行" }));

    expect(await within(dialog).findByRole("checkbox", { name: "猫の給水機" }))
      .toBeInTheDocument();
  });
  it("キーボードで検索欄へ入り、Escapeで閉じて追加ボタンへ焦点を戻す", () => {
    render(<ConsumableForm mode="create" />);

    const trigger = screen.getByRole("button", { name: "＋ 管理対象を追加" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "管理対象を追加" });
    const search = within(dialog).getByLabelText("管理対象を検索");

    expect(search).toHaveFocus();

    // 検索欄はフォームの内側にあるため、Enterでの暗黙の送信を止める。
    const enter = createEvent.keyDown(search, { key: "Enter" });
    fireEvent(search, enter);

    expect(enter.defaultPrevented).toBe(true);

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

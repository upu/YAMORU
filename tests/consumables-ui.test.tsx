import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { ConsumableForm } from "../src/app/consumables/consumable-form";
import {
  ConsumableDetailContent,
  type ConsumableDetailData,
} from "../src/app/consumables/[id]/page";
import {
  ConsumablesContent,
  type ConsumableListItem,
} from "../src/app/consumables/page";
import { RelatedConsumablesSection } from "../src/app/consumables/related-consumables";

afterEach(cleanup);

const CONSUMABLE: ConsumableListItem = {
  id: "consumable-1",
  name: "トイレットペーパー",
};

const OPTIONS = {
  managedItems: [
    { id: "item-1", name: "猫の給水機" },
    { id: "item-2", name: "お風呂" },
  ],
  taskRules: [
    { id: "rule-1", managedItemName: "猫の給水機", title: "フィルター交換" },
  ],
};

describe("消耗品一覧", () => {
  it("家の台帳から戻れる独立一覧で、関連なしの消耗品も登録・確認できる", () => {
    render(<ConsumablesContent consumables={[CONSUMABLE]} />);

    expect(screen.getByRole("heading", { level: 1, name: "消耗品" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /家の台帳へ戻る/u })).toHaveAttribute(
      "href",
      "/managed-items",
    );
    expect(screen.getByRole("link", { name: "消耗品を登録" })).toHaveAttribute(
      "href",
      "/consumables/new",
    );
    expect(screen.getByRole("link", { name: "トイレットペーパー" })).toHaveAttribute(
      "href",
      "/consumables/consumable-1",
    );
  });
});

describe("消耗品登録・編集フォーム", () => {
  it("参照情報と任意のManagedItem・Todoを通常の入力で選べる", () => {
    render(<ConsumableForm initialManagedItemId="item-1" mode="create" options={OPTIONS} />);

    expect(screen.getByLabelText("名前")).toHaveAttribute("maxLength", "100");
    expect(screen.getByLabelText("メモ（任意）")).toHaveAttribute("maxLength", "1000");
    expect(screen.getByLabelText("型番・品番（任意）")).toHaveAttribute("maxLength", "200");
    expect(screen.getByLabelText("外部リンク（任意）")).toHaveAttribute("type", "url");
    expect(screen.getByRole("checkbox", { name: "猫の給水機" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "お風呂" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "フィルター交換（猫の給水機）" }))
      .not.toBeChecked();
    expect(screen.getByText("どれにも関連付けず、家庭共通の消耗品として登録できます。"))
      .toBeInTheDocument();
  });
});

describe("消耗品詳細", () => {
  it("関連なしでも参照情報を確認でき、後から編集できる", () => {
    const consumable: ConsumableDetailData = {
      externalUrl: "https://example.com/toilet-paper",
      id: "consumable-1",
      managedItems: [],
      name: "トイレットペーパー",
      note: "収納棚の上段",
      productCode: "TP-12",
      taskRules: [],
    };

    render(<ConsumableDetailContent consumable={consumable} />);

    expect(screen.getByRole("heading", { level: 1, name: "トイレットペーパー" }))
      .toBeInTheDocument();
    expect(screen.getByText("収納棚の上段")).toBeInTheDocument();
    expect(screen.getByText("TP-12")).toBeInTheDocument();
    expect(screen.getByText("関連する管理対象はありません。")).toBeInTheDocument();
    expect(screen.getByText("関連するTodoはありません。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "消耗品を編集" })).toHaveAttribute(
      "href",
      "/consumables/consumable-1/edit",
    );
  });
});

describe("管理対象・Todoの関連消耗品", () => {
  it("管理対象詳細から関連品を確認し、その管理対象を引き継いで追加できる", () => {
    render(
      <RelatedConsumablesSection
        addHref="/consumables/new?managedItemId=item-1"
        consumables={[CONSUMABLE]}
      />,
    );

    const section = screen.getByRole("region", { name: "関連する消耗品" });
    expect(within(section).getByRole("link", { name: "トイレットペーパー" }))
      .toHaveAttribute("href", "/consumables/consumable-1");
    expect(within(section).getByRole("link", { name: "消耗品を追加" }))
      .toHaveAttribute("href", "/consumables/new?managedItemId=item-1");
  });

  it("Todo詳細では関連消耗品を参照できるが追加操作は表示しない", () => {
    render(<RelatedConsumablesSection consumables={[CONSUMABLE]} />);

    expect(screen.getByRole("link", { name: "トイレットペーパー" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "消耗品を追加" })).not.toBeInTheDocument();
  });
});

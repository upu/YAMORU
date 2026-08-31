import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
// Issue #292: 関連付けの候補はダイアログを開いたときにサーバーへ問い合わせる。
// 候補の取得と選択の詳細はtests/consumable-relation-picker-ui.test.tsxで確認する。
vi.mock("../src/app/consumables/relation-actions", () => ({
  searchConsumableManagedItems: vi.fn(),
  searchConsumableTaskRules: vi.fn(),
}));

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
  stockStatus: "low",
};

describe("消耗品一覧", () => {
  it("Issue #291: 台帳の3入口で消耗品を現在地として示し、関連なしでも登録・確認できる", () => {
    render(<ConsumablesContent consumables={[CONSUMABLE]} />);

    expect(screen.getByRole("heading", { level: 1, name: "消耗品" })).toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "台帳の種類" });
    expect(within(navigation).getByRole("link", { name: "備品" }))
      .toHaveAttribute("href", "/managed-items?kind=asset");
    expect(within(navigation).getByRole("link", { name: "サービス・契約" }))
      .toHaveAttribute("href", "/managed-items?kind=service");
    expect(within(navigation).getByRole("link", { name: "消耗品" }))
      .toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: /家の台帳へ戻る/u }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "消耗品を登録" })).toHaveAttribute(
      "href",
      "/consumables/new",
    );
    expect(screen.getByRole("link", { name: "トイレットペーパー" })).toHaveAttribute(
      "href",
      "/consumables/consumable-1",
    );
    expect(screen.getByText("少ない")).toBeInTheDocument();
  });
});

describe("消耗品登録・編集フォーム", () => {
  it("参照情報を入力でき、関連付けは選択済みと追加操作だけを表示する", () => {
    render(
      <ConsumableForm
        initialManagedItem={{ id: "item-1", name: "猫の給水機" }}
        mode="create"
      />,
    );

    expect(screen.getByLabelText("名前")).toHaveAttribute("maxLength", "100");
    expect(screen.getByLabelText("メモ（任意）")).toHaveAttribute("maxLength", "1000");
    expect(screen.getByLabelText("型番・品番（任意）")).toHaveAttribute("maxLength", "200");
    expect(screen.getByLabelText("外部リンク（任意）")).toHaveAttribute("type", "url");
    expect(screen.getByRole("group", { name: "関連する管理対象（1件・任意）" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "猫の給水機を関連から外す" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "＋ Todoを追加" })).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
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
      stockStatus: "available",
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
    expect(within(section).getByText("少ない"))
      .toHaveClass("stock-status-badge", "stock-status-low");
    expect(within(section).getByRole("link", { name: "消耗品を追加" }))
      .toHaveAttribute("href", "/consumables/new?managedItemId=item-1");
  });

  it("Todo詳細では各在庫状態を確認できるが追加操作は表示しない", () => {
    render(<RelatedConsumablesSection consumables={[
      { id: "filter", name: "交換フィルター", stockStatus: "available" },
      { id: "soap", name: "洗剤", stockStatus: "out" },
    ]} />);

    expect(screen.getByRole("link", { name: "交換フィルター" })).toBeInTheDocument();
    expect(screen.getByText("ある"))
      .toHaveClass("stock-status-badge", "stock-status-available");
    expect(screen.getByText("ない"))
      .toHaveClass("stock-status-badge", "stock-status-out");
    expect(screen.queryByRole("link", { name: "消耗品を追加" })).not.toBeInTheDocument();
  });
});

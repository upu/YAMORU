import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
// Issue #292: 関連付けの候補はダイアログを開いたときにサーバーへ問い合わせる。
// 候補の取得と選択の詳細はtests/consumable-relation-picker-ui.test.tsx、
// 詳細画面からの追加・解除はtests/consumable-detail-relations.test.tsxで確認する。
vi.mock("../src/app/consumables/relation-actions", () => ({
  searchConsumableManagedItems: vi.fn(),
  searchConsumableTaskRules: vi.fn(),
  setConsumableManagedItemRelation: vi.fn(),
  setConsumableTaskRuleRelation: vi.fn(),
}));

import { ConsumableForm } from "../src/app/consumables/consumable-form";
import {
  ConsumableDetailContent,
  type ConsumableDetailData,
} from "../src/app/consumables/[id]/page";
import { ConsumableRegistrationContent } from "../src/app/consumables/new/page";
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

    // Issue #309: 台帳内のカテゴリを切り替えてもページ見出しは「家の台帳」を保つ。
    expect(screen.getByRole("heading", { level: 1, name: "家の台帳" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "消耗品" })).not.toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "台帳の種類" });
    expect(within(navigation).getByRole("link", { name: "備品" }))
      .toHaveAttribute("href", "/managed-items?kind=asset");
    expect(within(navigation).getByRole("link", { name: "サービス・契約" }))
      .toHaveAttribute("href", "/managed-items?kind=service");
    expect(within(navigation).getByRole("link", { name: "消耗品" }))
      .toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: /家の台帳へ戻る/u }))
      .not.toBeInTheDocument();
    for (const addLink of screen.getAllByRole("link", { name: "消耗品を登録" })) {
      expect(addLink).toHaveAttribute("href", "/consumables/new");
    }
    expect(screen.getByRole("link", { name: "トイレットペーパー" })).toHaveAttribute(
      "href",
      "/consumables/consumable-1",
    );
    expect(screen.getByText("少ない")).toBeInTheDocument();
  });

  it("Issue #309: 台帳共通のヘッダーと、備品・サービス・契約と同じ位置の登録導線を持つ", () => {
    render(<ConsumablesContent consumables={[CONSUMABLE]} />);

    expect(screen.getByText("家の備品、サービス・契約、消耗品をまとめます。"))
      .toBeInTheDocument();

    // カテゴリ切り替え → 登録導線 → 一覧の順序を、備品・サービス・契約と揃える。
    const navigation = screen.getByRole("navigation", { name: "台帳の種類" });
    const list = screen.getByRole("region", { name: "登録済みの消耗品" });
    const addLink = within(list).getByRole("link", { name: "消耗品を登録" });
    expect(navigation.compareDocumentPosition(addLink) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(addLink.compareDocumentPosition(
      within(list).getByRole("link", { name: "トイレットペーパー" }),
    ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Issue #391: 右下の共通追加ボタンも「消耗品を登録」で、「台帳に追加」の
    // ような別名を同じ画面に出さない。表示は画面幅ごとにどちらか一方だけになる。
    expect(screen.getAllByRole("link", { name: "消耗品を登録" })).toHaveLength(2);
    expect(screen.queryByRole("link", { name: "台帳に追加" }))
      .not.toBeInTheDocument();
  });

  it("Issue #309: 消耗品が無いときも、登録の入口の言葉で案内する", () => {
    render(<ConsumablesContent consumables={[]} />);

    expect(screen.getByText(/まだ消耗品はありません。「消耗品を登録」から台帳に追加できます。/u))
      .toBeInTheDocument();
    for (const addLink of screen.getAllByRole("link", { name: "消耗品を登録" })) {
      expect(addLink).toHaveAttribute("href", "/consumables/new");
    }
  });
});

// Issue #393: 「ADD CONSUMABLE」「消耗品を登録」「登録内容」と役割の重なる
// 見出しが3つ並び、最初の入力欄までの縦幅を使っていた。
describe("消耗品登録ページの上部(Issue #393)", () => {
  it("キッカーと「登録内容」を画面に出さず、見出し一つに収める", () => {
    render(<ConsumableRegistrationContent hasHousehold />);

    expect(screen.getByRole("heading", { level: 1, name: "消耗品を登録" }))
      .toBeInTheDocument();
    expect(screen.queryByText("ADD CONSUMABLE")).not.toBeInTheDocument();
    // 入力領域の意味は支援技術向けに残す(画面には出さない)。
    const form = screen.getByRole("region", { name: "登録内容" });
    expect(within(form).getByRole("heading", { level: 2, name: "登録内容" }))
      .toHaveClass("sr-only");
    expect(within(form).getByLabelText("名前")).toBeRequired();
  });

  it("家庭未所属なら登録フォームを隠して家庭作成を案内する", () => {
    render(<ConsumableRegistrationContent hasHousehold={false} />);

    expect(screen.getByRole("heading", { name: "家庭を作成してください" }))
      .toBeInTheDocument();
    expect(screen.queryByLabelText("名前")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "家庭を作成する" }))
      .toHaveAttribute("href", "/account");
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
    // Issue #393: 関連付けが任意であることはlegendの「（1件・任意）」が示すため、
    // 同じ意味の説明文をフォーム末尾へ重ねない。
    expect(screen.queryByText("どれにも関連付けず、家庭共通の消耗品として登録できます。"))
      .not.toBeInTheDocument();
  });
});

describe("消耗品詳細", () => {
  it("関連なしでも参照情報を確認でき、後から編集できる", () => {
    const consumable: ConsumableDetailData = {
      externalUrl: "https://example.com/toilet-paper",
      id: "consumable-1",
      isPinned: false,
      managedItems: [],
      name: "トイレットペーパー",
      note: "収納棚の上段",
      productCode: "TP-12",
      refills: [],
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
    // Issue #311: 本体属性の編集と関連付けの編集を、別々の入口として示す。
    expect(screen.getByRole("button", { name: "管理対象を追加" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Todoを追加" })).toBeInTheDocument();
  });

  it("Issue #295: 関連Todoの一日・期間・未定・次回なしをTokyo暦日で表示する", () => {
    const consumable: ConsumableDetailData = {
      externalUrl: null,
      id: "consumable-1",
      isPinned: false,
      managedItems: [],
      name: "交換フィルター",
      note: null,
      productCode: null,
      refills: [],
      stockStatus: "available",
      taskRules: [
        {
          id: "dated",
          managedItemName: "空気清浄機",
          nextOccurrence: {
            dueAt: "2026-09-09T15:00:00.000Z",
            scheduledFor: "2026-09-09T15:00:00.000Z",
          },
          title: "フィルター交換",
        },
        {
          id: "window",
          managedItemName: "猫の給水機",
          nextOccurrence: {
            dueAt: "2026-09-19T15:00:00.000Z",
            scheduledFor: "2026-09-09T15:00:00.000Z",
          },
          title: "カートリッジ交換",
        },
        {
          id: "undated",
          managedItemName: null,
          nextOccurrence: { dueAt: null, scheduledFor: null },
          title: "交換日を決める",
        },
        {
          id: "completed",
          managedItemName: null,
          nextOccurrence: null,
          title: "一度だけ交換する",
        },
      ],
    };

    render(<ConsumableDetailContent consumable={consumable} />);

    const todoSection = screen.getByRole("region", { name: "関連するTodo" });
    expect(within(todoSection).getByText("次回: 9月10日")).toBeInTheDocument();
    expect(within(todoSection).getByText("次回: 9月10日〜9月20日")).toBeInTheDocument();
    expect(within(todoSection).getByText("次回: 未定")).toBeInTheDocument();
    expect(within(todoSection).getByText("次回予定なし")).toBeInTheDocument();
    expect(within(todoSection).getAllByRole("listitem")).toHaveLength(4);
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

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../src/app/consumables/relation-actions", () => ({
  searchConsumableManagedItems: vi.fn(),
  searchConsumableTaskRules: vi.fn(),
  setConsumableManagedItemRelation: vi.fn(),
  setConsumableTaskRuleRelation: vi.fn(),
}));

import {
  ConsumableDetailContent,
  type ConsumableDetailData,
} from "../src/app/consumables/[id]/page";
import {
  ManagedItemDetailContent,
  type ManagedItemDetailData,
} from "../src/app/managed-items/[id]/page";
import { TodoDetailContent, type TodoDetailData } from "../src/app/todos/[id]/page";

afterEach(cleanup);

// Issue #391: Todo・備品・消耗品の詳細で、戻る導線と編集導線の位置と表現を
// 一つの規約(src/app/detail-back-nav.tsx)へそろえる。画面ごとに操作位置を
// 探し直さずに済むことを、3画面へ同じ検査を当てて確かめる。

const TODO: TodoDetailData = {
  assigneeUserId: null,
  completion: null,
  consumables: [],
  dueAt: "2026-09-02",
  id: "occurrence-1",
  isCompleted: false,
  isMaintenance: false,
  managedItemId: null,
  managedItemName: null,
  note: null,
  recurrenceBasis: "once",
  recurrenceLabel: "繰り返しなし",
  scheduledFor: "2026-09-02",
  taskRuleId: "rule-1",
  title: "フィルターの申請",
};

const MANAGED_ITEM: ManagedItemDetailData = {
  actorName: "家族A",
  consumables: [],
  currentUserId: "user-1",
  externalLinks: [],
  id: "item-1",
  itemTypeLabel: "ペット用品",
  kindCode: "asset",
  kindLabel: "備品",
  members: [{ nickname: "ぽっぷ", userId: "user-1" }],
  name: "猫の浄水器",
  note: null,
  pendingTodos: [],
  productInfo: null,
  recentCompletions: [],
  startedOn: null,
};

const CONSUMABLE: ConsumableDetailData = {
  externalUrl: null,
  id: "consumable-1",
  isPinned: false,
  managedItems: [],
  name: "トイレットペーパー",
  note: null,
  productCode: null,
  refills: [],
  stockStatus: "low",
  taskRules: [],
};

type DetailCase = {
  backHref: string;
  backLabel: string;
  editHref: string;
  editLabel: string;
  render: () => void;
  title: string;
};

const DETAIL_CASES: DetailCase[] = [
  {
    backHref: "/todos",
    backLabel: "← Todo一覧へ戻る",
    editHref: "/todos/occurrence-1/edit",
    editLabel: "Todoを編集",
    render: () => {
      render(
        <TodoDetailContent actorName="自分" currentUserId="user-1" members={[]} todo={TODO} />,
      );
    },
    title: "Todo詳細",
  },
  {
    backHref: "/managed-items",
    backLabel: "← 家の台帳へ戻る",
    editHref: "/managed-items/item-1/edit",
    editLabel: "管理対象を編集",
    render: () => {
      render(<ManagedItemDetailContent item={MANAGED_ITEM} />);
    },
    title: "備品(管理対象)詳細",
  },
  {
    backHref: "/consumables",
    backLabel: "← 家の台帳へ戻る",
    editHref: "/consumables/consumable-1/edit",
    editLabel: "消耗品を編集",
    render: () => {
      render(<ConsumableDetailContent consumable={CONSUMABLE} />);
    },
    title: "消耗品詳細",
  },
];

describe.each(DETAIL_CASES)("$title の共通ページヘッダー(Issue #391)", (detail) => {
  it("ページ最上部の同じ位置・同じ表現で、属する一覧へ戻れる", () => {
    detail.render();

    const backNav = screen.getByRole("navigation", { name: "ページ移動" });
    expect(within(backNav).getByRole("link", { name: detail.backLabel }))
      .toHaveAttribute("href", detail.backHref);

    // main直下の最初の要素として置き、画面ごとに位置が変わらないようにする。
    const main = document.querySelector("main");
    expect(main?.firstElementChild).toBe(backNav);
  });

  it("編集導線は本文のセクション見出しの横に、共通のアイコンリンクとして置く", () => {
    detail.render();

    const editLink = screen.getByRole("link", { name: detail.editLabel });
    expect(editLink).toHaveAttribute("href", detail.editHref);
    expect(editLink).toHaveClass("icon-link");
    // ページヘッダー(戻る導線)ではなく、対象の内容を表すセクションの中に置く。
    expect(screen.getByRole("navigation", { name: "ページ移動" }))
      .not.toContainElement(editLink);
    expect(editLink.closest(".detail-section-heading")).not.toBeNull();
  });
});

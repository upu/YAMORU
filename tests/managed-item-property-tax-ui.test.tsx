import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/auth", () => ({ auth: vi.fn() }));

import { ManagedItemDetailContent } from "../src/app/managed-items/[id]/page";
import { ManagedItemEditForm } from "../src/app/managed-items/[id]/edit/managed-item-edit-form";
import { ManagedItemForm } from "../src/app/managed-items/managed-item-form";
import { ManagedItemsContent } from "../src/app/managed-items/page";

afterEach(cleanup);

const CLASSIFICATION_OPTIONS = {
  itemTypes: [
    { code: "property_tax", kindCode: "obligation", label: "固定資産税" },
  ],
  kinds: [
    { code: "asset", label: "モノ" },
    { code: "obligation", label: "支払い・手続き" },
  ],
};

describe("固定資産税の台帳表示(Issue #177)", () => {
  it("新規登録と編集で固定資産税を選べる", () => {
    const { unmount } = render(
      <ManagedItemForm classificationOptions={CLASSIFICATION_OPTIONS} />,
    );
    fireEvent.change(screen.getByLabelText("大分類"), {
      target: { value: "obligation" },
    });
    expect(screen.getByRole("option", { name: "固定資産税" })).toBeInTheDocument();
    unmount();

    render(
      <ManagedItemEditForm
        classificationOptions={CLASSIFICATION_OPTIONS}
        customItemType={null}
        externalUrl={null}
        id="property-tax"
        itemTypeCode="property_tax"
        kindCode="obligation"
        name="固定資産税"
      />,
    );
    expect(screen.getByLabelText("大分類")).toHaveValue("obligation");
    expect(screen.getByLabelText("詳しい種類（任意）")).toHaveValue("property_tax");
  });

  it("一覧と詳細で大分類「支払い・手続き」と固定資産税を識別できる", () => {
    const { unmount } = render(
      <ManagedItemsContent
        household={{ id: "household-a", name: "家庭A" }}
        items={[{
          id: "property-tax",
          itemTypeLabel: "固定資産税",
          kindLabel: "支払い・手続き",
          name: "2026年度 固定資産税",
        }]}
      />,
    );
    const list = screen.getByRole("region", { name: "登録済みの管理対象" });
    const listBadges = within(list).getByRole("list", { name: "分類" });
    expect(within(listBadges).getAllByRole("listitem").map((badge) => badge.textContent))
      .toEqual(["大分類: 支払い・手続き", "詳しい種類: 固定資産税"]);
    // ラベル自体が中黒を含むため、連結表示に戻ると区切りが読み取れなくなる。
    expect(within(list).queryByText("支払い・手続き・固定資産税")).not.toBeInTheDocument();
    unmount();

    render(
      <ManagedItemDetailContent item={{
        actorName: "家族A",
        currentUserId: "user-a",
        externalLinks: [],
        id: "property-tax",
        itemTypeLabel: "固定資産税",
        kindLabel: "支払い・手続き",
        lastActivity: null,
        members: [],
        name: "2026年度 固定資産税",
        pendingTodos: [],
        recentCompletions: [],
      }} />,
    );
    const detailBadges = screen.getByRole("list", { name: "分類" });
    expect(within(detailBadges).getAllByRole("listitem").map((badge) => badge.textContent))
      .toEqual(["大分類: 支払い・手続き", "詳しい種類: 固定資産税"]);
  });
});

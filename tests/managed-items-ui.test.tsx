import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/auth", () => ({ auth: vi.fn() }));

import {
  ManagedItemDetailContent,
  type ManagedItemDetailData,
} from "../src/app/managed-items/[id]/page";
import {
  ManagedItemsContent,
  type ManagedItemSummary,
} from "../src/app/managed-items/page";

afterEach(cleanup);

// 大分類と詳しい種類が連結された一つの文字列へ戻らないことを、
// バッジ一件ずつの読み上げテキストで確認する(Issue #195)。
function classificationBadgeTexts(scope: HTMLElement): (string | null)[] {
  const badges = within(scope).getByRole("list", { name: "分類" });
  return within(badges)
    .getAllByRole("listitem")
    .map((badge) => badge.textContent);
}

const REGISTERED_ITEM: ManagedItemSummary = {
  id: "item-1",
  itemTypeLabel: "ペット用品",
  kindLabel: "モノ",
  name: "猫の浄水器",
};

describe("家の台帳一覧", () => {
  it("家庭未所属の利用者には台帳を隠して家庭作成を案内する", () => {
    render(<ManagedItemsContent household={null} items={[]} />);

    expect(
      screen.getByRole("heading", { name: "家庭を作成してください" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("名前")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "家庭を作成する" })).toHaveAttribute(
      "href",
      "/account",
    );
    expect(screen.queryByRole("link", { name: "台帳に追加" }))
      .not.toBeInTheDocument();
  });

  it("家庭所属済みなら一覧を主要内容として空状態から登録ページへ進める", () => {
    render(
      <ManagedItemsContent
        household={{ id: "household-1", name: "テスト家庭" }}
        items={[]}
      />,
    );

    const list = screen.getByRole("region", { name: "登録済みの管理対象" });
    expect(within(list).getByText(/まだ管理対象はありません。/u))
      .toBeInTheDocument();
    expect(within(list).queryByRole("link", { name: "管理対象を登録" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "台帳に追加" })).toHaveAttribute(
      "href",
      "/managed-items/new",
    );
    expect(screen.queryByLabelText("名前")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /ホームへ戻る/ }),
    ).not.toBeInTheDocument();
  });

  it("登録済み一覧から登録ページへ進める", () => {
    render(
      <ManagedItemsContent
        household={{ id: "household-1", name: "テスト家庭" }}
        items={[REGISTERED_ITEM]}
      />,
    );

    expect(screen.queryByRole("link", { name: "管理対象を登録" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "台帳に追加" })).toHaveAttribute(
      "href",
      "/managed-items/new",
    );
    expect(screen.queryByLabelText("名前")).not.toBeInTheDocument();
  });

  it("自家庭の登録済みManagedItemを詳細へのリンクとして表示する", () => {
    render(
      <ManagedItemsContent
        household={{ id: "household-1", name: "テスト家庭" }}
        items={[REGISTERED_ITEM]}
      />,
    );

    const list = screen.getByRole("region", { name: "登録済みの管理対象" });
    expect(classificationBadgeTexts(list)).toEqual([
      "大分類: モノ",
      "詳しい種類: ペット用品",
    ]);
    expect(within(list).queryByText("モノ・ペット用品")).not.toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "猫の浄水器" })).toHaveAttribute(
      "href",
      "/managed-items/item-1",
    );
  });

  it("詳しい種類が未設定なら一覧に大分類のバッジだけを表示する", () => {
    render(
      <ManagedItemsContent
        household={{ id: "household-1", name: "テスト家庭" }}
        items={[{ ...REGISTERED_ITEM, itemTypeLabel: null }]}
      />,
    );

    const list = screen.getByRole("region", { name: "登録済みの管理対象" });
    expect(classificationBadgeTexts(list)).toEqual(["大分類: モノ"]);
  });
});

describe("登録済みManagedItem詳細", () => {
  it("名前、種類、複数の安全な外部リンクを表示する", () => {
    const item: ManagedItemDetailData = {
      actorName: "家族A",
      currentUserId: "user-1",
      externalLinks: [
        { id: "link-1", url: "https://example.com/product" },
        { id: "link-2", url: "http://example.com/manual" },
      ],
      id: "item-1",
      itemTypeLabel: "ペット用品",
      kindLabel: "モノ",
      lastActivity: null,
      members: [],
      name: "猫の浄水器",
      note: null,
      pendingTodos: [],
      productInfo: null,
      purchasedOn: null,
      recentCompletions: [],
    };

    render(<ManagedItemDetailContent item={item} />);

    expect(screen.getByRole("heading", { name: "猫の浄水器" })).toBeInTheDocument();
    expect(classificationBadgeTexts(document.body)).toEqual([
      "大分類: モノ",
      "詳しい種類: ペット用品",
    ]);
    const links = screen.getAllByRole("link", { name: /外部リンクを開く/ });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("外部リンクがない場合も明確に表示する", () => {
    render(
      <ManagedItemDetailContent
        item={{
          ...REGISTERED_ITEM,
          actorName: "家族A",
          currentUserId: "user-1",
          externalLinks: [],
          lastActivity: null,
          members: [],
          note: null,
          pendingTodos: [],
          productInfo: null,
          purchasedOn: null,
          recentCompletions: [],
        }}
      />,
    );

    expect(screen.getByText("外部リンクは登録されていません。")).toBeInTheDocument();
  });

  it("詳しい種類が未設定なら詳細に大分類のバッジだけを表示する", () => {
    render(
      <ManagedItemDetailContent
        item={{
          ...REGISTERED_ITEM,
          actorName: "家族A",
          currentUserId: "user-1",
          externalLinks: [],
          itemTypeLabel: null,
          lastActivity: null,
          members: [],
          note: null,
          pendingTodos: [],
          productInfo: null,
          purchasedOn: null,
          recentCompletions: [],
        }}
      />,
    );

    expect(classificationBadgeTexts(document.body)).toEqual(["大分類: モノ"]);
    expect(screen.queryByText(/詳しい種類/)).not.toBeInTheDocument();
  });

  it("保存データが壊れていても危険なスキームをリンク表示しない", () => {
    render(
      <ManagedItemDetailContent
        item={{
          ...REGISTERED_ITEM,
          actorName: "家族A",
          currentUserId: "user-1",
          externalLinks: [{ id: "unsafe-link", url: "javascript:alert(1)" }],
          lastActivity: null,
          members: [],
          note: null,
          pendingTodos: [],
          productInfo: null,
          purchasedOn: null,
          recentCompletions: [],
        }}
      />,
    );

    expect(screen.queryByRole("link", { name: /外部リンクを開く/ })).not.toBeInTheDocument();
    expect(screen.getByText("外部リンクは登録されていません。")).toBeInTheDocument();
  });

  it("最後にいつ・誰がを上部に表示する", () => {
    render(
      <ManagedItemDetailContent
        item={{
          ...REGISTERED_ITEM,
          actorName: "家族A",
          currentUserId: "user-1",
          externalLinks: [],
          lastActivity: { occurredAt: "2026-08-10T00:00:00.000Z", performerName: "たろう" },
          members: [],
          note: null,
          pendingTodos: [],
          productInfo: null,
          purchasedOn: null,
          recentCompletions: [],
        }}
      />,
    );

    const summary = screen.getByRole("region", { name: "最後にいつ・誰が" });
    expect(within(summary).getByText("2026年8月10日")).toBeInTheDocument();
    expect(within(summary).getByText("たろう")).toBeInTheDocument();
  });

  it("完了の記録がない場合は最後にいつ・誰がに空状態を表示する", () => {
    render(
      <ManagedItemDetailContent
        item={{
          ...REGISTERED_ITEM,
          actorName: "家族A",
          currentUserId: "user-1",
          externalLinks: [],
          lastActivity: null,
          members: [],
          note: null,
          pendingTodos: [],
          productInfo: null,
          purchasedOn: null,
          recentCompletions: [],
        }}
      />,
    );

    const summary = screen.getByRole("region", { name: "最後にいつ・誰が" });
    expect(within(summary).getByText("まだ完了の記録はありません。")).toBeInTheDocument();
  });
});

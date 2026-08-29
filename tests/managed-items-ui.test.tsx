import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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

  it("Issue #237: 説明を外部リンク偏重にせず、ITEMSと登録済みの管理対象の重複見出しを画面上から外す", () => {
    render(
      <ManagedItemsContent
        household={{ id: "household-1", name: "テスト家庭" }}
        items={[REGISTERED_ITEM]}
      />,
    );

    expect(screen.getByText("家で管理するものをまとめます。")).toBeInTheDocument();
    expect(screen.queryByText(/確認に使う外部リンク/u)).not.toBeInTheDocument();
    expect(screen.queryByText("ITEMS")).not.toBeInTheDocument();

    // 一覧領域の意味は支援技術向けに残すが、画面上の見出しとしては出さない。
    const listHeading = screen.getByRole("heading", { name: "登録済みの管理対象" });
    expect(listHeading).toHaveClass("sr-only");
    expect(screen.getByRole("region", { name: "登録済みの管理対象" }))
      .toBeInTheDocument();
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
      kindCode: "asset",
      kindLabel: "モノ",
      members: [],
      name: "猫の浄水器",
      note: null,
      pendingTodos: [],
      productInfo: null,
      recentCompletions: [],
      startedOn: null,
    };

    render(<ManagedItemDetailContent item={item} />);

    expect(screen.getByRole("heading", { name: "猫の浄水器" })).toBeInTheDocument();
    expect(classificationBadgeTexts(document.body)).toEqual([
      "大分類: モノ",
      "詳しい種類: ペット用品",
    ]);
    // Issue #240: 外部リンクは「この管理対象の記録」に統合される。
    const links = screen.getAllByRole("link", { name: /外部リンクを開く/ });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
  });

  // Issue #240: 記録・外部リンクのいずれも未設定なら、空メッセージや空の
  // 項目一覧を表示しない。編集導線(鉛筆アイコン)だけは残す。
  it("外部リンクも記録も未設定なら、この管理対象の記録に空メッセージを表示しない", () => {
    render(
      <ManagedItemDetailContent
        item={{
          ...REGISTERED_ITEM,
          actorName: "家族A",
          currentUserId: "user-1",
          externalLinks: [],
          members: [],
          note: null,
          pendingTodos: [],
          kindCode: "asset",
          productInfo: null,
          recentCompletions: [],
          startedOn: null,
        }}
      />,
    );

    const record = screen.getByRole("region", { name: "この管理対象の記録" });
    expect(within(record).queryByText(/登録されていません/)).not.toBeInTheDocument();
    expect(within(record).getByRole("link", { name: "管理対象を編集" }))
      .toBeInTheDocument();
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
          members: [],
          note: null,
          pendingTodos: [],
          kindCode: "asset",
          productInfo: null,
          recentCompletions: [],
          startedOn: null,
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
          members: [],
          note: null,
          pendingTodos: [],
          kindCode: "asset",
          productInfo: null,
          recentCompletions: [],
          startedOn: null,
        }}
      />,
    );

    const record = screen.getByRole("region", { name: "この管理対象の記録" });
    expect(within(record).queryByRole("link", { name: /外部リンクを開く/ })).not.toBeInTheDocument();
    expect(within(record).queryByText("外部リンク")).not.toBeInTheDocument();
  });
});

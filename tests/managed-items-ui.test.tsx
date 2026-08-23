import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth", () => ({ auth: vi.fn() }));

import {
  ManagedItemDetailContent,
  type ManagedItemDetailData,
} from "../app/managed-items/[id]/page";
import {
  ManagedItemsContent,
  type ManagedItemSummary,
} from "../app/managed-items/page";

afterEach(cleanup);

const REGISTERED_ITEM: ManagedItemSummary = {
  id: "item-1",
  kind: "pet_supplies",
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
  });

  it("家庭所属済みなら一覧を主要内容として空状態から登録ページへ進める", () => {
    render(
      <ManagedItemsContent
        household={{ id: "household-1", name: "テスト家庭" }}
        items={[]}
      />,
    );

    const list = screen.getByRole("region", { name: "登録済みの管理対象" });
    expect(within(list).getByText("まだ管理対象はありません。")).toBeInTheDocument();
    expect(
      within(list).getByRole("link", { name: "管理対象を登録" }),
    ).toHaveAttribute("href", "/managed-items/new");
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

    expect(screen.getByRole("link", { name: "管理対象を登録" })).toHaveAttribute(
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
    expect(within(list).getByText("ペット用品")).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "猫の浄水器" })).toHaveAttribute(
      "href",
      "/managed-items/item-1",
    );
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
      kind: "pet_supplies",
      lastActivity: null,
      members: [],
      name: "猫の浄水器",
      pendingTodos: [],
      recentCompletions: [],
    };

    render(<ManagedItemDetailContent item={item} />);

    expect(screen.getByRole("heading", { name: "猫の浄水器" })).toBeInTheDocument();
    expect(screen.getByText("ペット用品")).toBeInTheDocument();
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
          pendingTodos: [],
          recentCompletions: [],
        }}
      />,
    );

    expect(screen.getByText("外部リンクは登録されていません。")).toBeInTheDocument();
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
          pendingTodos: [],
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
          pendingTodos: [],
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
          pendingTodos: [],
          recentCompletions: [],
        }}
      />,
    );

    const summary = screen.getByRole("region", { name: "最後にいつ・誰が" });
    expect(within(summary).getByText("まだ完了の記録はありません。")).toBeInTheDocument();
  });
});

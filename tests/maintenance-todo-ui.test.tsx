import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/auth", () => ({ auth: vi.fn() }));

import {
  ManagedItemDetailContent,
  type ManagedItemDetailData,
} from "../src/app/managed-items/[id]/page";

afterEach(cleanup);

const ITEM_WITH_TODO: ManagedItemDetailData = {
  actorName: "家族A",
  currentUserId: "user-1",
  externalLinks: [],
  id: "item-1",
  itemTypeLabel: "ペット用品",
  kindLabel: "モノ",
  lastActivity: null,
  members: [],
  name: "猫の浄水器",
  note: null,
  pendingTodos: [
    {
      assigneeUserId: null,
      badge: "そろそろ",
      dueAt: "2026-11-05T15:00:00.000Z",
      id: "occurrence-1",
      meta: "11月6日までが推奨期間です",
      scheduledFor: "2026-10-08T15:00:00.000Z",
      recurrenceBasis: "completion",
      title: "フィルター交換",
      tone: "reminder",
    },
  ],
  productInfo: null,
  purchasedOn: null,
  recentCompletions: [],
};

describe("ManagedItem詳細のメンテナンスTodo", () => {
  it("編集画面へ移動できる(Issue #40)", () => {
    render(<ManagedItemDetailContent item={ITEM_WITH_TODO} />);

    expect(screen.getByRole("link", { name: "編集" })).toHaveAttribute(
      "href",
      "/managed-items/item-1/edit",
    );
  });

  it("専用登録ページへ管理対象を引き継いで移動できる", () => {
    render(<ManagedItemDetailContent item={ITEM_WITH_TODO} />);

    expect(screen.queryByLabelText("Todo名")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Todoを追加" })).toHaveAttribute(
      "href",
      "/todos/new?managedItemId=item-1",
    );
  });

  it("現在のpending Todo名と推奨期間の分類(YDR-017)を表示する", () => {
    render(<ManagedItemDetailContent item={ITEM_WITH_TODO} />);

    const todoList = screen.getByRole("region", { name: "現在のTodo" });
    expect(within(todoList).getByText("フィルター交換")).toBeInTheDocument();
    expect(within(todoList).getByText("そろそろ")).toBeInTheDocument();
    expect(within(todoList).getByText("繰り返し")).toBeInTheDocument();
    expect(
      within(todoList).getByText("11月6日までが推奨期間です"),
    ).toBeInTheDocument();
    expect(
      within(todoList).getByRole("button", { name: "フィルター交換を記録" }),
    ).toBeInTheDocument();
  });

  it("一回限りTodoを詳細画面で見分けられる", () => {
    const onceTodo = {
      ...ITEM_WITH_TODO.pendingTodos[0],
      badge: "予定",
      dueAt: "2026-10-08T15:00:00.000Z",
      meta: "10月9日の予定です",
      recurrenceBasis: "once" as const,
      scheduledFor: "2026-10-08T15:00:00.000Z",
      title: "今回だけ点検",
      tone: "upcoming" as const,
    };

    render(
      <ManagedItemDetailContent
        item={{ ...ITEM_WITH_TODO, pendingTodos: [onceTodo] }}
      />,
    );

    const todoList = screen.getByRole("region", { name: "現在のTodo" });
    expect(within(todoList).getByText("繰り返しなし")).toBeInTheDocument();
    expect(within(todoList).getByText("10月9日の予定です")).toBeInTheDocument();
  });

  it("予定日未定の一回限りTodoを表示し、延期ではなく予定日設定を案内する", () => {
    const undatedTodo = {
      ...ITEM_WITH_TODO.pendingTodos[0],
      badge: "未定",
      dueAt: null,
      meta: "予定日: 未定",
      recurrenceBasis: "once" as const,
      scheduledFor: null,
      title: "通知書が届いたら申請",
      tone: "upcoming" as const,
    };

    render(
      <ManagedItemDetailContent
        item={{ ...ITEM_WITH_TODO, pendingTodos: [undatedTodo] }}
      />,
    );

    const todoList = screen.getByRole("region", { name: "現在のTodo" });
    expect(within(todoList).getByText("予定日: 未定")).toBeInTheDocument();
    expect(within(todoList).getByRole("button", { name: "通知書が届いたら申請の予定日を設定する" }))
      .toBeInTheDocument();
    expect(within(todoList).queryByRole("button", { name: /延期/ })).not.toBeInTheDocument();
  });

  it("具体日がある一回限りTodoは予定日を未定に戻せる", () => {
    const onceTodo = {
      ...ITEM_WITH_TODO.pendingTodos[0],
      badge: "予定",
      dueAt: "2026-10-08T15:00:00.000Z",
      meta: "10月9日の予定です",
      recurrenceBasis: "once" as const,
      scheduledFor: "2026-10-08T15:00:00.000Z",
      title: "今回だけ点検",
      tone: "upcoming" as const,
    };

    render(
      <ManagedItemDetailContent
        item={{ ...ITEM_WITH_TODO, pendingTodos: [onceTodo] }}
      />,
    );

    const todoList = screen.getByRole("region", { name: "現在のTodo" });
    expect(within(todoList).getByRole("button", { name: "今回だけ点検の予定日を未定に戻す" }))
      .toBeInTheDocument();
    expect(within(todoList).getByRole("button", { name: "今回だけ点検を延期する" }))
      .toBeInTheDocument();
  });

  it("定例日基準Todoを詳細画面で見分けられる", () => {
    const calendarTodo = {
      ...ITEM_WITH_TODO.pendingTodos[0],
      badge: "予定",
      dueAt: "2026-10-08T15:00:00.000Z",
      meta: "10月9日の予定です",
      recurrenceBasis: "calendar" as const,
      scheduledFor: "2026-10-08T15:00:00.000Z",
      title: "毎月の点検",
      tone: "upcoming" as const,
    };

    render(
      <ManagedItemDetailContent
        item={{ ...ITEM_WITH_TODO, pendingTodos: [calendarTodo] }}
      />,
    );

    const todoList = screen.getByRole("region", { name: "現在のTodo" });
    expect(within(todoList).getByText("曜日・日付で繰り返す")).toBeInTheDocument();
    expect(within(todoList).getByText("10月9日の予定です")).toBeInTheDocument();
  });

  it("未完了Todoがない場合は空状態を表示する", () => {
    render(
      <ManagedItemDetailContent item={{ ...ITEM_WITH_TODO, pendingTodos: [] }} />,
    );

    expect(screen.getByText("現在の未完了Todoはありません。")).toBeInTheDocument();
  });

  it("完了の記録がない場合は空状態を表示する", () => {
    render(<ManagedItemDetailContent item={ITEM_WITH_TODO} />);

    const recentSection = screen.getByRole("region", { name: "直近の完了" });
    expect(
      within(recentSection).getByText("まだ完了の記録はありません。"),
    ).toBeInTheDocument();
  });

  it("直近の完了を日本時間で表示し、Todo詳細への導線だけを表示する", () => {
    render(
      <ManagedItemDetailContent
        item={{
          ...ITEM_WITH_TODO,
          productInfo: null,
          purchasedOn: null,
          recentCompletions: [
            {
              id: "occurrence-0",
              occurredAt: "2026-09-01T15:00:00.000Z",
              title: "フィルター交換",
            },
          ],
        }}
      />,
    );

    const recentSection = screen.getByRole("region", { name: "直近の完了" });
    expect(within(recentSection).getByRole("link", { name: "フィルター交換" }))
      .toHaveAttribute("href", "/todos/occurrence-0");
    expect(
      within(recentSection).getByText("2026年9月2日に完了"),
    ).toBeInTheDocument();
    expect(within(recentSection).queryByRole("button", { name: "フィルター交換を修正" }))
      .not.toBeInTheDocument();
  });
});

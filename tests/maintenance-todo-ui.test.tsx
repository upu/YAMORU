import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ManagedItemDetailContent,
  type ManagedItemDetailData,
} from "../app/managed-items/[id]/page";

afterEach(cleanup);

const ITEM_WITH_TODO: ManagedItemDetailData = {
  actorName: "家族A",
  currentUserId: "user-1",
  externalLinks: [],
  id: "item-1",
  kind: "pet_supplies",
  lastActivity: null,
  members: [],
  name: "猫の浄水器",
  pendingTodos: [
    {
      assigneeUserId: null,
      badge: "そろそろ",
      dueAt: "2026-11-05T15:00:00.000Z",
      id: "occurrence-1",
      meta: "11月6日までが推奨期間です",
      scheduledFor: "2026-10-08T15:00:00.000Z",
      title: "フィルター交換",
      tone: "reminder",
    },
  ],
  recentCompletions: [],
};

describe("ManagedItem詳細のメンテナンスTodo", () => {
  it("1〜2週間後と前回実施日だけで登録できるフォームを表示する", () => {
    render(<ManagedItemDetailContent item={ITEM_WITH_TODO} />);

    const form = screen.getByRole("region", {
      name: "メンテナンスTodoを登録",
    });
    expect(within(form).getByLabelText("Todo名")).toHaveAttribute(
      "maxLength",
      "100",
    );
    expect(within(form).getByText("完了した日から繰り返す")).toBeInTheDocument();
    expect(within(form).getByLabelText("最短")).toHaveValue(1);
    expect(within(form).getByLabelText("最長")).toHaveValue(2);
    expect(within(form).getByLabelText("単位")).toHaveValue("week");
    expect(within(form).getByRole("option", { name: "日後" })).toBeInTheDocument();
    expect(within(form).getByRole("option", { name: "週間後" })).toBeInTheDocument();
    expect(
      within(form).getByText("完了すると、その日から1〜2週間後が次回の目安になります。"),
    ).toBeInTheDocument();
    expect(within(form).getByLabelText("前回実施日から計算する")).toBeChecked();
    expect(within(form).getByLabelText("次回の目安開始日を指定する")).not.toBeChecked();
    expect(within(form).getByLabelText("前回実施日")).toHaveAttribute(
      "type",
      "date",
    );
    expect(within(form).queryByLabelText("最初の推奨上限日")).not.toBeInTheDocument();
    expect(within(form).getByText(/Asia\/Tokyo/)).toBeInTheDocument();
  });

  it("現在のpending Todo名と推奨期間の分類(YDR-017)を表示する", () => {
    render(<ManagedItemDetailContent item={ITEM_WITH_TODO} />);

    const todoList = screen.getByRole("region", { name: "現在のTodo" });
    expect(within(todoList).getByText("フィルター交換")).toBeInTheDocument();
    expect(within(todoList).getByText("そろそろ")).toBeInTheDocument();
    expect(
      within(todoList).getByText("11月6日までが推奨期間です"),
    ).toBeInTheDocument();
    expect(
      within(todoList).getByRole("button", { name: "フィルター交換を記録" }),
    ).toBeInTheDocument();
  });

  it("次回の目安開始日を選ぶと日付項目と自動計算の説明を切り替える", () => {
    render(<ManagedItemDetailContent item={ITEM_WITH_TODO} />);

    fireEvent.click(screen.getByLabelText("次回の目安開始日を指定する"));

    expect(screen.getByLabelText("次回の目安開始日")).toHaveAttribute(
      "type",
      "date",
    );
    expect(
      screen.getByText("目安の上限日は、指定した開始日から自動計算します。"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("前回実施日")).not.toBeInTheDocument();
  });

  it("日単位へ切り替えると説明にも反映する", () => {
    render(<ManagedItemDetailContent item={ITEM_WITH_TODO} />);

    fireEvent.change(screen.getByLabelText("単位"), {
      target: { value: "day" },
    });

    expect(
      screen.getByText("完了すると、その日から1〜2日後が次回の目安になります。"),
    ).toBeInTheDocument();
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

  it("直近の完了を日本時間で表示する", () => {
    render(
      <ManagedItemDetailContent
        item={{
          ...ITEM_WITH_TODO,
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
    expect(within(recentSection).getByText("フィルター交換")).toBeInTheDocument();
    expect(
      within(recentSection).getByText("2026年9月2日に完了"),
    ).toBeInTheDocument();
  });
});

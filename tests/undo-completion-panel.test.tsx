import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { undoMaintenanceTaskCompletionMock } = vi.hoisted(() => ({
  undoMaintenanceTaskCompletionMock: vi.fn(),
}));

vi.mock("../app/managed-items/[id]/actions", () => ({
  undoMaintenanceTaskCompletion: undoMaintenanceTaskCompletionMock,
}));

import { UndoCompletionPanel } from "../app/managed-items/[id]/undo-completion-panel";

afterEach(cleanup);

function openDialog() {
  fireEvent.click(
    screen.getByRole("button", { name: "フィルター交換の完了を取り消す" }),
  );
}

describe("UndoCompletionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("取消トリガーを押すと確認ダイアログを日本時間の日付で表示する", () => {
    render(
      <UndoCompletionPanel
        managedItemId="item-1"
        occurredAt="2026-09-01T15:00:00.000Z"
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    openDialog();

    const dialog = screen.getByRole("dialog", {
      name: "フィルター交換の完了を取り消す",
    });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      screen.getByText(
        "2026年9月2日の完了を取り消します。未完了のTodoに戻り、自動生成された次回の予定は削除されます。",
      ),
    ).toBeInTheDocument();
  });

  it("やめるを押すと取消アクションを呼ばずに閉じ、元の位置へ焦点を戻す", () => {
    render(
      <UndoCompletionPanel
        managedItemId="item-1"
        occurredAt="2026-09-01T15:00:00.000Z"
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "フィルター交換の完了を取り消す",
    });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "やめる" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(undoMaintenanceTaskCompletionMock).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it("確認すると同じOccurrenceへ取消アクションを呼び、ダイアログを閉じる", () => {
    undoMaintenanceTaskCompletionMock.mockResolvedValue({
      message: "完了の取消を記録しました。",
      status: "success",
    });

    render(
      <UndoCompletionPanel
        managedItemId="item-1"
        occurredAt="2026-09-01T15:00:00.000Z"
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "この完了を取り消す" }));

    expect(
      screen.queryByRole("dialog", { name: "フィルター交換の完了を取り消す" }),
    ).not.toBeInTheDocument();
    expect(undoMaintenanceTaskCompletionMock).toHaveBeenCalledTimes(1);
    const [managedItemId, occurrenceId, idempotencyKey] =
      undoMaintenanceTaskCompletionMock.mock.calls[0] as [
        string,
        string,
        string,
      ];
    expect(managedItemId).toBe("item-1");
    expect(occurrenceId).toBe("occurrence-1");
    expect(typeof idempotencyKey).toBe("string");
  });

  it("Escapeで閉じて元の位置へ焦点を戻す", () => {
    render(
      <UndoCompletionPanel
        managedItemId="item-1"
        occurredAt="2026-09-01T15:00:00.000Z"
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "フィルター交換の完了を取り消す",
    });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", {
      name: "フィルター交換の完了を取り消す",
    });
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("失敗すると案内メッセージを表示する", async () => {
    undoMaintenanceTaskCompletionMock.mockResolvedValue({
      message: "次回Todoがすでに変更されているため自動取消できません。手動で訂正してください。",
      status: "error",
    });

    render(
      <UndoCompletionPanel
        managedItemId="item-1"
        occurredAt="2026-09-01T15:00:00.000Z"
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "この完了を取り消す" }));

    expect(
      await screen.findByText(
        "次回Todoがすでに変更されているため自動取消できません。手動で訂正してください。",
      ),
    ).toBeInTheDocument();
  });
});

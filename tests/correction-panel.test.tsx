import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  correctCompletionOccurredAtMock,
  correctCompletionPerformerMock,
  undoMaintenanceTaskCompletionMock,
} = vi.hoisted(() => ({
  correctCompletionOccurredAtMock: vi.fn(),
  correctCompletionPerformerMock: vi.fn(),
  undoMaintenanceTaskCompletionMock: vi.fn(),
}));

vi.mock("../app/managed-items/[id]/actions", () => ({
  correctCompletionOccurredAt: correctCompletionOccurredAtMock,
  correctCompletionPerformer: correctCompletionPerformerMock,
  undoMaintenanceTaskCompletion: undoMaintenanceTaskCompletionMock,
}));

import { CorrectionPanel } from "../app/managed-items/[id]/correction-panel";

afterEach(cleanup);

const MEMBERS = [
  { nickname: "ぽっぷ", userId: "user-self" },
  { nickname: "家族B", userId: "user-other" },
];

function renderPanel(performedByUserId: string | null = "user-self") {
  render(
    <CorrectionPanel
      currentUserId="user-self"
      managedItemId="item-1"
      members={MEMBERS}
      occurredAt="2026-09-01T15:00:00.000Z"
      occurrenceId="occurrence-1"
      performedByUserId={performedByUserId}
      taskTitle="フィルター交換"
    />,
  );
}

function openChoice() {
  fireEvent.click(screen.getByRole("button", { name: "フィルター交換を修正" }));
}

describe("CorrectionPanel(#148)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("修正トリガーを押すと3つの選択肢を表示する", () => {
    renderPanel();
    openChoice();

    const dialog = screen.getByRole("dialog", { name: "フィルター交換を修正" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "実施日時を訂正する" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "実施者を訂正する" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完了を取り消す" })).toBeInTheDocument();
  });

  it("実施日時を訂正すると同じOccurrenceへ日付訂正アクションを呼び、ダイアログを閉じる", () => {
    correctCompletionOccurredAtMock.mockResolvedValue({
      message: "実施日時を訂正しました。",
      status: "success",
    });
    renderPanel();

    openChoice();
    fireEvent.click(screen.getByRole("button", { name: "実施日時を訂正する" }));
    fireEvent.change(screen.getByLabelText("実施日"), {
      target: { value: "2026-08-20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "この日付で訂正する" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(correctCompletionOccurredAtMock).toHaveBeenCalledTimes(1);
    const [managedItemId, occurrenceId, idempotencyKey, occurredOn] =
      correctCompletionOccurredAtMock.mock.calls[0] as [string, string, string, string];
    expect(managedItemId).toBe("item-1");
    expect(occurrenceId).toBe("occurrence-1");
    expect(typeof idempotencyKey).toBe("string");
    expect(occurredOn).toBe("2026-08-20");
  });

  it("実施者を訂正すると既定値が現在の実施者で、選び直した実施者訂正アクションを呼ぶ", () => {
    correctCompletionPerformerMock.mockResolvedValue({
      message: "実施者を訂正しました。",
      status: "success",
    });
    renderPanel("user-self");

    openChoice();
    fireEvent.click(screen.getByRole("button", { name: "実施者を訂正する" }));

    expect(
      screen.getByRole<HTMLSelectElement>("combobox", { name: "実施した人" }).value,
    ).toBe("user-self");

    fireEvent.change(screen.getByRole("combobox", { name: "実施した人" }), {
      target: { value: "user-other" },
    });
    fireEvent.click(screen.getByRole("button", { name: "この人で訂正する" }));

    expect(correctCompletionPerformerMock).toHaveBeenCalledTimes(1);
    const [managedItemId, occurrenceId, , performedByUserId] =
      correctCompletionPerformerMock.mock.calls[0] as [string, string, string, string];
    expect(managedItemId).toBe("item-1");
    expect(occurrenceId).toBe("occurrence-1");
    expect(performedByUserId).toBe("user-other");
  });

  it("実施者が未設定でも既定値はcurrentUserIdになる", () => {
    renderPanel(null);

    openChoice();
    fireEvent.click(screen.getByRole("button", { name: "実施者を訂正する" }));

    expect(
      screen.getByRole<HTMLSelectElement>("combobox", { name: "実施した人" }).value,
    ).toBe("user-self");
  });

  it("完了を取り消すを選ぶと確認画面を日本時間の日付で表示し、確定で取消アクションを呼ぶ", () => {
    undoMaintenanceTaskCompletionMock.mockResolvedValue({
      message: "完了の取消を記録しました。",
      status: "success",
    });
    renderPanel();

    openChoice();
    fireEvent.click(screen.getByRole("button", { name: "完了を取り消す" }));
    expect(
      screen.getByText(
        "2026年9月2日の完了を取り消します。未完了のTodoに戻り、次回の予定が作られている場合は未変更のものだけ削除されます。",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "この完了を取り消す" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(undoMaintenanceTaskCompletionMock).toHaveBeenCalledTimes(1);
    const [managedItemId, occurrenceId] = undoMaintenanceTaskCompletionMock.mock
      .calls[0] as [string, string];
    expect(managedItemId).toBe("item-1");
    expect(occurrenceId).toBe("occurrence-1");
  });

  it("選び方に戻ると選択肢画面へ戻り、他のアクションを呼ばない", () => {
    renderPanel();

    openChoice();
    fireEvent.click(screen.getByRole("button", { name: "実施日時を訂正する" }));
    fireEvent.click(screen.getByRole("button", { name: "← 選び方に戻る" }));

    expect(screen.getByRole("button", { name: "実施者を訂正する" })).toBeInTheDocument();
    expect(correctCompletionOccurredAtMock).not.toHaveBeenCalled();
  });

  it("Escapeで閉じて元の位置へ焦点を戻す", () => {
    renderPanel();

    const trigger = screen.getByRole("button", { name: "フィルター交換を修正" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "フィルター交換を修正" });
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("失敗すると案内メッセージを表示する", async () => {
    correctCompletionOccurredAtMock.mockResolvedValue({
      message: "次回Todoがすでに変更されているため、実施日時を訂正できません。次回Todoを手動で調整してください。",
      status: "error",
    });
    renderPanel();

    openChoice();
    fireEvent.click(screen.getByRole("button", { name: "実施日時を訂正する" }));
    fireEvent.change(screen.getByLabelText("実施日"), {
      target: { value: "2026-08-20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "この日付で訂正する" }));

    expect(
      await screen.findByText(
        "次回Todoがすでに変更されているため、実施日時を訂正できません。次回Todoを手動で調整してください。",
      ),
    ).toBeInTheDocument();
  });

  it("失敗後に再度開くと前回の失敗メッセージが消える(useState管理のopen()の契約)", async () => {
    correctCompletionPerformerMock.mockResolvedValue({
      message: "実施した人を指定できませんでした。同じ家庭のメンバーから選び直してください。",
      status: "error",
    });
    renderPanel();

    openChoice();
    fireEvent.click(screen.getByRole("button", { name: "実施者を訂正する" }));
    fireEvent.click(screen.getByRole("button", { name: "この人で訂正する" }));
    await screen.findByText(
      "実施した人を指定できませんでした。同じ家庭のメンバーから選び直してください。",
    );

    openChoice();

    expect(
      screen.queryByText(
        "実施した人を指定できませんでした。同じ家庭のメンバーから選び直してください。",
      ),
    ).not.toBeInTheDocument();
  });
});

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { postponeTaskOccurrenceMock } = vi.hoisted(() => ({
  postponeTaskOccurrenceMock: vi.fn(),
}));

vi.mock("../src/app/managed-items/[id]/actions", () => ({
  postponeTaskOccurrence: postponeTaskOccurrenceMock,
}));

import { PostponePanel } from "../src/app/managed-items/[id]/postpone-panel";

afterEach(cleanup);

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "フィルター交換を延期する" }));
}

function fillAndSubmit(dueOn: string) {
  fireEvent.change(screen.getByLabelText("実施する予定の新しい期限"), {
    target: { value: dueOn },
  });
  fireEvent.click(screen.getByRole("button", { name: "この日まで延期する" }));
}

describe("PostponePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("延期するトリガーを押すとダイアログを開き、日付入力の下限は翌日以降にする", () => {
    render(
      <PostponePanel
        managedItemId="item-1"
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    openDialog();

    const dialog = screen.getByRole("dialog", { name: "フィルター交換を延期" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // PostponePanelのtomorrowDateInput()と同じ計算(ローカル日付+1日)で
    // 期待値を求める。完了記録側のmax=today(過去日限定)と対になる最小値。
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const year = String(tomorrow.getFullYear());
    const month = String(tomorrow.getMonth() + 1).padStart(2, "0");
    const day = String(tomorrow.getDate()).padStart(2, "0");
    const expectedMin = `${year}-${month}-${day}`;
    const dateInput = screen.getByLabelText("実施する予定の新しい期限");
    expect(dateInput).toHaveAttribute("min", expectedMin);
    expect(dateInput).toHaveValue(expectedMin);
  });

  it("Escapeで閉じて元の位置へ焦点を戻す", () => {
    render(
      <PostponePanel
        managedItemId="item-1"
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    const trigger = screen.getByRole("button", { name: "フィルター交換を延期する" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "フィルター交換を延期" });
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("日付を指定して送信すると延期アクションを呼び、ダイアログを閉じる", () => {
    postponeTaskOccurrenceMock.mockResolvedValue({
      message: "9月1日まで延期しました。",
      status: "success",
    });

    render(
      <PostponePanel
        managedItemId="item-1"
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    openDialog();
    fillAndSubmit("2026-09-01");

    expect(
      screen.queryByRole("dialog", { name: "フィルター交換を延期" }),
    ).not.toBeInTheDocument();
    expect(postponeTaskOccurrenceMock).toHaveBeenCalledWith(
      "item-1",
      "occurrence-1",
      "2026-09-01",
    );
  });

  it("成功すると新しい期限と延期したことが分かるフィードバックを表示する", async () => {
    postponeTaskOccurrenceMock.mockResolvedValue({
      message: "9月1日まで延期しました。",
      status: "success",
    });

    render(
      <PostponePanel
        managedItemId="item-1"
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    openDialog();
    fillAndSubmit("2026-09-01");

    expect(await screen.findByText("9月1日まで延期しました。")).toBeInTheDocument();
  });

  it("失敗すると案内メッセージを表示する", async () => {
    postponeTaskOccurrenceMock.mockResolvedValue({
      message: "延期する日付は未来の日を指定してください。",
      status: "error",
    });

    render(
      <PostponePanel
        managedItemId="item-1"
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    openDialog();
    fillAndSubmit("2026-09-01");

    expect(
      await screen.findByText("延期する日付は未来の日を指定してください。"),
    ).toBeInTheDocument();
  });

  it("成功後に再度開くと前回の成功メッセージが消える(useDialogActionのopen()の契約)", async () => {
    postponeTaskOccurrenceMock.mockResolvedValue({
      message: "9月1日まで延期しました。",
      status: "success",
    });

    render(
      <PostponePanel
        managedItemId="item-1"
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    openDialog();
    fillAndSubmit("2026-09-01");
    await screen.findByText("9月1日まで延期しました。");

    openDialog();

    expect(screen.queryByText("9月1日まで延期しました。")).not.toBeInTheDocument();
  });
});

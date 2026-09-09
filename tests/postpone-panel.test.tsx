import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { postponeTaskOccurrenceMock } = vi.hoisted(() => ({
  postponeTaskOccurrenceMock: vi.fn(),
}));

vi.mock("../src/features/todos/actions/schedule", () => ({
  postponeTaskOccurrence: postponeTaskOccurrenceMock,
}));

import { PostponePanel } from "../src/features/todos/components/postpone-panel";

afterEach(cleanup);

// PostponePanelのtomorrowDateInput()と同じ計算。日付をリテラルで書くと、
// その日を過ぎた時点で入力のmin(翌日以降)を下回り、ブラウザのフォーム検証で
// 送信自体が止まってテストが落ちるため、送信値も期待値も常にここから求める。
// Issue #357: 実行環境のローカル日付ではなくAsia/Tokyoの暦日を1日進める
// (以前はローカル日付+1日で、UTCのCIランナーではJSTの00:00〜09:00にあたる
// 時間帯に本体と1日ずれていた)。
function tomorrowDateInput(): string {
  const todayInTokyo = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Tokyo",
    year: "numeric",
  }).format(new Date());
  const [year, month, day] = todayInTokyo.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
  return tomorrow.toISOString().slice(0, 10);
}

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
    // 完了記録側のmax=today(過去日限定)と対になる最小値。
    const expectedMin = tomorrowDateInput();
    const dateInput = screen.getByLabelText("実施する予定の新しい期限");
    expect(dateInput).toHaveAttribute("min", expectedMin);
    expect(dateInput).toHaveValue(expectedMin);
  });

  // Issue #357: 端末のタイムゾーンがAsia/Tokyoより後ろ(UTCなど)のとき、
  // JSTの00:00〜09:00にあたる時間帯はローカル暦日とTokyo暦日が1日ずれる。
  // ローカル暦日で既定値を出すと、すでに過去の日が入ったまま送信され
  // 「未来の日を指定してください」で失敗していた。
  it("端末がUTCでも、Asia/Tokyoの暦日で翌日を既定値にする", () => {
    // 2026-09-07T23:10Z = JSTでは2026-09-08 08:10。Tokyoの翌日は09-09。
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T23:10:00.000Z"));
    try {
      render(
        <PostponePanel
          managedItemId="item-1"
          occurrenceId="occurrence-1"
          taskTitle="フィルター交換"
        />,
      );

      openDialog();

      const dateInput = screen.getByLabelText("実施する予定の新しい期限");
      expect(dateInput).toHaveAttribute("min", "2026-09-09");
      expect(dateInput).toHaveValue("2026-09-09");
    } finally {
      vi.useRealTimers();
    }
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
    fillAndSubmit(tomorrowDateInput());

    expect(
      screen.queryByRole("dialog", { name: "フィルター交換を延期" }),
    ).not.toBeInTheDocument();
    expect(postponeTaskOccurrenceMock).toHaveBeenCalledWith(
      "item-1",
      "occurrence-1",
      tomorrowDateInput(),
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
    fillAndSubmit(tomorrowDateInput());

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
    fillAndSubmit(tomorrowDateInput());

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
    fillAndSubmit(tomorrowDateInput());
    await screen.findByText("9月1日まで延期しました。");

    openDialog();

    expect(screen.queryByText("9月1日まで延期しました。")).not.toBeInTheDocument();
  });
});

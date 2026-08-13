import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { completeMaintenanceTaskMock } = vi.hoisted(() => ({
  completeMaintenanceTaskMock: vi.fn(),
}));

vi.mock("../app/managed-items/[id]/actions", () => ({
  completeMaintenanceTask: completeMaintenanceTaskMock,
}));

import { CompleteTodoPanel } from "../app/managed-items/[id]/complete-todo-panel";

afterEach(cleanup);

function openAndCompleteNow() {
  fireEvent.click(
    screen.getByRole("button", { name: "フィルター交換を記録" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "今、自分がやった" }));
}

describe("CompleteTodoPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("完了を選ぶと同じOccurrenceへ完了アクションを呼び、ダイアログを閉じる", () => {
    completeMaintenanceTaskMock.mockResolvedValue({
      message: "完了を記録しました。",
      status: "success",
    });

    render(
      <CompleteTodoPanel
        managedItemId="item-1"
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    openAndCompleteNow();

    expect(
      screen.queryByRole("dialog", { name: "フィルター交換を記録" }),
    ).not.toBeInTheDocument();
    expect(completeMaintenanceTaskMock).toHaveBeenCalledTimes(1);
    const [managedItemId, occurrenceId, idempotencyKey, occurredOn] =
      completeMaintenanceTaskMock.mock.calls[0] as [
        string,
        string,
        string,
        string | null,
      ];
    expect(managedItemId).toBe("item-1");
    expect(occurrenceId).toBe("occurrence-1");
    expect(typeof idempotencyKey).toBe("string");
    // 「今、自分がやった」ではnullを渡し、サーバー側のnow()に決定を委ねる
    // (クライアント時計のずれで未来判定にならないようにするため)。
    expect(occurredOn).toBeNull();
  });

  it("同じマウント中の再送は同じ冪等性キーを使う", () => {
    completeMaintenanceTaskMock.mockResolvedValue({
      message: "完了を記録しました。",
      status: "success",
    });

    render(
      <CompleteTodoPanel
        managedItemId="item-1"
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    openAndCompleteNow();
    openAndCompleteNow();

    const firstKey = completeMaintenanceTaskMock.mock.calls[0]?.[2] as string;
    const secondKey = completeMaintenanceTaskMock.mock.calls[1]?.[2] as string;
    expect(secondKey).toBe(firstKey);
  });

  it("失敗すると最新状態の確認を案内する", async () => {
    completeMaintenanceTaskMock.mockResolvedValue({
      message: "他の操作で状態が変わりました。最新の状態を確認してください。",
      status: "error",
    });

    render(
      <CompleteTodoPanel
        managedItemId="item-1"
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    openAndCompleteNow();

    expect(
      await screen.findByText(
        "他の操作で状態が変わりました。最新の状態を確認してください。",
      ),
    ).toBeInTheDocument();
  });
});

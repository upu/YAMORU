import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { completeMaintenanceTaskMock } = vi.hoisted(() => ({
  completeMaintenanceTaskMock: vi.fn(),
}));

vi.mock("../src/app/managed-items/[id]/actions", () => ({
  completeMaintenanceTask: completeMaintenanceTaskMock,
}));

import { CompleteTodoPanel } from "../src/app/managed-items/[id]/complete-todo-panel";

afterEach(cleanup);

const MEMBERS = [
  { nickname: "ぽっぷ", userId: "user-self" },
  { nickname: "家族B", userId: "user-other" },
];

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

  it("ダイアログにactorNameで渡した実施者名を表示する(ハードコードしない)", () => {
    render(
      <CompleteTodoPanel
        actorName="ぽっぷ"
        currentUserId="user-self"
        managedItemId="item-1"
        members={MEMBERS}
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "フィルター交換を記録" }),
    );

    expect(screen.getByText("現在の日付・ぽっぷで記録")).toBeInTheDocument();
    expect(screen.queryByText(/家族A/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "詳しく記録する" }));

    // ラベルとselectがhtmlFor/idで結び付いていること(スクリーンリーダーが
    // 名前で識別できること)を、アクセシブルネーム付きのクエリで検証する。
    // 既定値は現在の利用者(Issue #18)。
    expect(
      screen.getByRole<HTMLSelectElement>("combobox", { name: "実施した人" })
        .value,
    ).toBe("user-self");
  });

  it("membersに現在の利用者が含まれない場合でも、既定値は自分になる(先頭optionの暗黙選択を防ぐ)", () => {
    render(
      <CompleteTodoPanel
        actorName="ぽっぷ"
        currentUserId="user-self"
        managedItemId="item-1"
        members={[{ nickname: "家族B", userId: "user-other" }]}
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "フィルター交換を記録" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "詳しく記録する" }));

    expect(
      screen.getByRole<HTMLSelectElement>("combobox", { name: "実施した人" })
        .value,
    ).toBe("user-self");
  });

  it("完了を選ぶと同じOccurrenceへ完了アクションを呼び、ダイアログを閉じる", () => {
    completeMaintenanceTaskMock.mockResolvedValue({
      message: "完了を記録しました。",
      status: "success",
    });

    render(
      <CompleteTodoPanel
        actorName="家族A"
        currentUserId="user-self"
        managedItemId="item-1"
        members={MEMBERS}
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    openAndCompleteNow();

    expect(
      screen.queryByRole("dialog", { name: "フィルター交換を記録" }),
    ).not.toBeInTheDocument();
    expect(completeMaintenanceTaskMock).toHaveBeenCalledTimes(1);
    const [managedItemId, occurrenceId, idempotencyKey, occurredOn, performedByUserId] =
      completeMaintenanceTaskMock.mock.calls[0] as [
        string,
        string,
        string,
        string | null,
        string | null,
      ];
    expect(managedItemId).toBe("item-1");
    expect(occurrenceId).toBe("occurrence-1");
    expect(typeof idempotencyKey).toBe("string");
    // 「今、自分がやった」ではnullを渡し、サーバー側のnow()に決定を委ねる
    // (クライアント時計のずれで未来判定にならないようにするため)。
    expect(occurredOn).toBeNull();
    // 追加入力なしの完了では実施者も指定せず、操作主体をRPC側の既定値に委ねる
    // (Issue #18, YDR-020)。
    expect(performedByUserId).toBeNull();
  });

  it("詳しく記録するで別の実施者を選ぶとperformedByUserIdを渡す", () => {
    completeMaintenanceTaskMock.mockResolvedValue({
      message: "完了を記録しました。",
      status: "success",
    });

    render(
      <CompleteTodoPanel
        actorName="ぽっぷ"
        currentUserId="user-self"
        managedItemId="item-1"
        members={MEMBERS}
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "フィルター交換を記録" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "詳しく記録する" }));
    fireEvent.change(screen.getByRole("combobox", { name: "実施した人" }), {
      target: { value: "user-other" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "この内容で記録する" }),
    );

    expect(completeMaintenanceTaskMock).toHaveBeenCalledTimes(1);
    const [, , , , performedByUserId] = completeMaintenanceTaskMock.mock
      .calls[0] as [string, string, string, string | null, string | null];
    expect(performedByUserId).toBe("user-other");
  });

  it("同じマウント中の再送は同じ冪等性キーを使う", () => {
    completeMaintenanceTaskMock.mockResolvedValue({
      message: "完了を記録しました。",
      status: "success",
    });

    render(
      <CompleteTodoPanel
        actorName="家族A"
        currentUserId="user-self"
        managedItemId="item-1"
        members={MEMBERS}
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

  it("主要操作を支援技術から名前で識別でき、Escapeで閉じて元の位置へ焦点を戻す", () => {
    render(
      <CompleteTodoPanel
        actorName="家族A"
        currentUserId="user-self"
        managedItemId="item-1"
        members={MEMBERS}
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    const openCompletionButton = screen.getByRole("button", {
      name: "フィルター交換を記録",
    });
    fireEvent.click(openCompletionButton);

    const dialog = screen.getByRole("dialog", { name: "フィルター交換を記録" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "閉じる" })).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(openCompletionButton).toHaveFocus();
  });

  it("失敗すると最新状態の確認を案内する", async () => {
    completeMaintenanceTaskMock.mockResolvedValue({
      message: "他の操作で状態が変わりました。最新の状態を確認してください。",
      status: "error",
    });

    render(
      <CompleteTodoPanel
        actorName="家族A"
        currentUserId="user-self"
        managedItemId="item-1"
        members={MEMBERS}
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

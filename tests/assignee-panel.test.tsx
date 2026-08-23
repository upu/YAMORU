import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { claimTaskOccurrenceAssigneeMock, setTaskOccurrenceAssigneeMock } = vi.hoisted(() => ({
  claimTaskOccurrenceAssigneeMock: vi.fn(),
  setTaskOccurrenceAssigneeMock: vi.fn(),
}));

vi.mock("../app/managed-items/[id]/actions", () => ({
  claimTaskOccurrenceAssignee: claimTaskOccurrenceAssigneeMock,
  setTaskOccurrenceAssignee: setTaskOccurrenceAssigneeMock,
}));

import { AssigneePanel } from "../app/managed-items/[id]/assignee-panel";

afterEach(cleanup);

const MEMBERS = [
  { nickname: "ぽっぷ", userId: "user-1" },
  { nickname: "たろう", userId: "user-2" },
];

describe("AssigneePanel(Issue #72)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未設定は「誰でも可」を選択済みで表示し、「やるよ」も表示する(Issue #77)", () => {
    render(
      <AssigneePanel
        assigneeUserId={null}
        managedItemId="item-1"
        members={MEMBERS}
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    expect(
      screen.getByLabelText("フィルター交換の担当"),
    ).toHaveValue("");
    expect(screen.getByRole("option", { name: "誰でも可" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "フィルター交換を自分の担当にする" }),
    ).toBeInTheDocument();
  });

  it("既に設定済みの担当者を選択済みで表示し、「やるよ」は表示しない(Issue #77)", () => {
    render(
      <AssigneePanel
        assigneeUserId="user-2"
        managedItemId="item-1"
        members={MEMBERS}
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    expect(screen.getByLabelText("フィルター交換の担当")).toHaveValue("user-2");
    expect(
      screen.queryByRole("button", { name: "フィルター交換を自分の担当にする" }),
    ).not.toBeInTheDocument();
  });

  it("家庭メンバーを選ぶと担当変更アクションを呼ぶ", () => {
    setTaskOccurrenceAssigneeMock.mockResolvedValue({
      message: "担当を変更しました。",
      status: "success",
    });

    render(
      <AssigneePanel
        assigneeUserId={null}
        managedItemId="item-1"
        members={MEMBERS}
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    fireEvent.change(screen.getByLabelText("フィルター交換の担当"), {
      target: { value: "user-2" },
    });

    expect(setTaskOccurrenceAssigneeMock).toHaveBeenCalledWith(
      "item-1",
      "occurrence-1",
      "user-2",
    );
  });

  it("誰でも可を選ぶとnullで担当変更アクションを呼ぶ(解除)", () => {
    setTaskOccurrenceAssigneeMock.mockResolvedValue({
      message: "担当を変更しました。",
      status: "success",
    });

    render(
      <AssigneePanel
        assigneeUserId="user-2"
        managedItemId="item-1"
        members={MEMBERS}
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    fireEvent.change(screen.getByLabelText("フィルター交換の担当"), {
      target: { value: "" },
    });

    expect(setTaskOccurrenceAssigneeMock).toHaveBeenCalledWith(
      "item-1",
      "occurrence-1",
      null,
    );
  });

  it("失敗すると案内メッセージを表示する", async () => {
    setTaskOccurrenceAssigneeMock.mockResolvedValue({
      message: "担当者を指定できませんでした。同じ家庭のメンバーから選び直してください。",
      status: "error",
    });

    render(
      <AssigneePanel
        assigneeUserId={null}
        managedItemId="item-1"
        members={MEMBERS}
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    fireEvent.change(screen.getByLabelText("フィルター交換の担当"), {
      target: { value: "user-2" },
    });

    expect(
      await screen.findByText(
        "担当者を指定できませんでした。同じ家庭のメンバーから選び直してください。",
      ),
    ).toBeInTheDocument();
  });

  it("「やるよ」を押すと同じOccurrenceへ引き受けアクションを呼ぶ(Issue #77)", () => {
    claimTaskOccurrenceAssigneeMock.mockResolvedValue({
      message: "担当にしました。",
      status: "success",
    });

    render(
      <AssigneePanel
        assigneeUserId={null}
        managedItemId="item-1"
        members={MEMBERS}
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "フィルター交換を自分の担当にする" }),
    );

    expect(claimTaskOccurrenceAssigneeMock).toHaveBeenCalledWith("item-1", "occurrence-1");
  });

  it("既に他の家族が担当していれば案内メッセージを表示する(Issue #77)", async () => {
    claimTaskOccurrenceAssigneeMock.mockResolvedValue({
      message: "すでに他の家族が担当しています。最新の状態を確認してください。",
      status: "error",
    });

    render(
      <AssigneePanel
        assigneeUserId={null}
        managedItemId="item-1"
        members={MEMBERS}
        occurrenceId="occurrence-1"
        taskTitle="フィルター交換"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "フィルター交換を自分の担当にする" }),
    );

    expect(
      await screen.findByText(
        "すでに他の家族が担当しています。最新の状態を確認してください。",
      ),
    ).toBeInTheDocument();
  });
});

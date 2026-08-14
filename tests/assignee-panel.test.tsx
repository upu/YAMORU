import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { setTaskOccurrenceAssigneeMock } = vi.hoisted(() => ({
  setTaskOccurrenceAssigneeMock: vi.fn(),
}));

vi.mock("../app/managed-items/[id]/actions", () => ({
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

  it("未設定は「誰でも可」を選択済みで表示する", () => {
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
  });

  it("既に設定済みの担当者を選択済みで表示する", () => {
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
});

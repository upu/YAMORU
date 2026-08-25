import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { updateTodoMock } = vi.hoisted(() => ({ updateTodoMock: vi.fn() }));

vi.mock("../src/app/todos/[id]/actions", () => ({ updateTodo: updateTodoMock }));

import { TodoEditForm } from "../src/app/todos/[id]/edit/todo-edit-form";

const MANAGED_ITEMS = [
  { id: "item-1", name: "猫の浄水器" },
  { id: "item-2", name: "リビングのエアコン" },
];
const MEMBERS = [
  { nickname: "ぽっぷ", userId: "user-1" },
  { nickname: "たろう", userId: "user-2" },
];

function renderForm(overrides: Partial<Parameters<typeof TodoEditForm>[0]> = {}) {
  return render(
    <TodoEditForm
      assigneeUserId={null}
      id="occurrence-1"
      managedItemId={null}
      managedItems={MANAGED_ITEMS}
      members={MEMBERS}
      plannedDate=""
      title="通知書が届いたら申請"
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("Todo編集フォーム(TodoEditForm)", () => {
  it("現在の保存内容を初期値として表示する", () => {
    renderForm({
      assigneeUserId: "user-2",
      managedItemId: "item-1",
      plannedDate: "2026-09-02",
    });

    expect(screen.getByLabelText("Todo名")).toHaveValue("通知書が届いたら申請");
    expect(screen.getByLabelText("予定日")).toHaveValue("2026-09-02");
    expect(screen.getByLabelText("担当")).toHaveValue("user-2");
    expect(screen.getByRole("radio", { name: "猫の浄水器" })).toBeChecked();
  });

  it("予定日未定のTodoでは予定日を空欄にし、管理対象なしを選んだ状態にする", () => {
    renderForm();

    expect(screen.getByLabelText("予定日")).toHaveValue("");
    expect(screen.getByRole("radio", { name: "関連する管理対象なし" })).toBeChecked();
    expect(screen.getByLabelText("担当")).toHaveValue("");
  });

  it("担当の候補は同じ家庭のメンバーと誰でも可に限る", () => {
    renderForm();

    expect(
      Array.from(screen.getByLabelText("担当").querySelectorAll("option")).map(
        (option) => option.textContent,
      ),
    ).toEqual(["誰でも可", "ぽっぷ", "たろう"]);
  });

  it("管理対象は名前で絞り込んで選び直せる", () => {
    renderForm({ managedItemId: "item-1" });

    fireEvent.change(screen.getByRole("searchbox", { name: "管理対象を検索" }), {
      target: { value: "エアコン" },
    });
    // 選択中の管理対象は、検索語に一致しなくても候補の先頭に残る。
    expect(screen.getByRole("radio", { name: "猫の浄水器" })).toBeChecked();
    const option = screen.getByRole("radio", { name: "リビングのエアコン" });
    fireEvent.click(option);

    expect(option).toBeChecked();
    // 検索語を消しても選び直した管理対象は保たれる。
    fireEvent.change(screen.getByRole("searchbox", { name: "管理対象を検索" }), {
      target: { value: "" },
    });
    expect(screen.getByText("リビングのエアコンを選択しています。")).toBeInTheDocument();
  });

  it("キャンセルは保存せずTodo詳細へ戻る", () => {
    renderForm();

    expect(screen.getByRole("link", { name: "キャンセル" })).toHaveAttribute(
      "href",
      "/todos/occurrence-1",
    );
    expect(updateTodoMock).not.toHaveBeenCalled();
  });
});

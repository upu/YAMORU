import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { updateRecurringOccurrenceMock, updateRecurringRuleMock, updateTodoMock } = vi.hoisted(() => ({
  updateRecurringOccurrenceMock: vi.fn(),
  updateRecurringRuleMock: vi.fn(),
  updateTodoMock: vi.fn(),
}));

vi.mock("../src/app/todos/[id]/actions", () => ({
  updateRecurringOccurrence: updateRecurringOccurrenceMock,
  updateRecurringRule: updateRecurringRuleMock,
  updateTodo: updateTodoMock,
}));

import { RecurringTodoEditForms } from "../src/app/todos/[id]/edit/recurring-todo-edit-form";
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

describe("繰り返しTodo編集フォーム(RecurringTodoEditForms)", () => {
  it("今回の担当・現在期限と、今後のルールを混同しない二つの領域で表示する", () => {
    render(
      <RecurringTodoEditForms
        id="occurrence-1"
        managedItems={MANAGED_ITEMS}
        members={MEMBERS}
        occurrence={{
          assigneeUserId: "user-2",
          dueDate: "2026-09-20",
          scheduledDate: "2026-09-07",
        }}
        rule={{
          managedItemId: "item-1",
          recurrenceBasis: "calendar",
          scheduleDayOfMonth: null,
          scheduleDaysOfWeek: [1, 4],
          scheduleKind: "weekly",
          scheduleMonth: null,
          scheduleMonthEnd: false,
          scheduleWeekOfMonth: null,
          title: "毎週の家族会議",
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "今回のTodo" })).toBeInTheDocument();
    expect(screen.getByText("本来の予定日: 2026年9月7日")).toBeInTheDocument();
    expect(screen.getByLabelText("現在の期限")).toHaveValue("2026-09-20");
    expect(screen.getByLabelText("担当")).toHaveValue("user-2");

    expect(screen.getByRole("heading", { name: "今後の繰り返し" })).toBeInTheDocument();
    expect(screen.getByLabelText("Todo名")).toHaveValue("毎週の家族会議");
    expect(screen.getByLabelText("定例パターン")).toHaveValue("weekly");
    // Issue #102: 毎週は複数の曜日をチェックボックスで選ぶ。保存済みの曜日は
    // すべてチェック済みで表示する。
    expect(screen.getByRole("checkbox", { name: "月曜日" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "木曜日" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "金曜日" })).not.toBeChecked();
    expect(screen.getByText(/現在回の予定と期限は変わりません/u)).toBeInTheDocument();
    expect(screen.getByText(/過去の完了記録は変わりません/u)).toBeInTheDocument();
  });

  it("固定間隔では保存済みの起点・間隔・単位を初期表示する", () => {
    render(
      <RecurringTodoEditForms
        id="occurrence-1"
        managedItems={MANAGED_ITEMS}
        members={MEMBERS}
        occurrence={{
          assigneeUserId: null,
          dueDate: "2026-09-15",
          scheduledDate: "2026-09-15",
        }}
        rule={{
          intervalAnchorOn: "2026-09-01",
          intervalCount: 2,
          intervalUnit: "week",
          managedItemId: null,
          recurrenceBasis: "interval",
          title: "隔週の確認",
        }}
      />,
    );

    expect(screen.getByLabelText("間隔")).toHaveValue(2);
    expect(screen.getByLabelText("単位")).toHaveValue("week");
    expect(screen.getByLabelText("起点日")).toHaveValue("2026-09-01");
  });
});

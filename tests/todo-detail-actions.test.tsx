import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Issue #392: 未完了Todoの詳細から担当と完了を行えるようにする。ホームや
// Todoカードと同じ部品を通すため、ここで見るのは「詳細画面がその部品へ
// 正しい対象を渡し、成功・キャンセル・エラーを画面に出すか」。部品そのものの
// 細かい挙動はtests/assignee-panel.test.tsx、tests/complete-todo-panel.test.tsxが
// 受け持つ。
const {
  claimTaskOccurrenceAssigneeMock,
  completeMaintenanceTaskMock,
  setTaskOccurrenceAssigneeMock,
  undoMaintenanceTaskCompletionMock,
} = vi.hoisted(() => ({
  claimTaskOccurrenceAssigneeMock: vi.fn(),
  completeMaintenanceTaskMock: vi.fn(),
  setTaskOccurrenceAssigneeMock: vi.fn(),
  undoMaintenanceTaskCompletionMock: vi.fn(),
}));

// ページ本体(サーバーコンポーネント)のimportを通すためのモック。この
// テストが見るのは描画済みのTodoDetailContentだけで、取得経路は
// tests/todo-detail.test.tsxが受け持つ。
vi.mock("../src/lib/auth/current-user", () => ({ requireUser: vi.fn() }));
vi.mock("../src/lib/d1/context", () => ({ getD1Context: vi.fn() }));
vi.mock("../src/lib/d1/todos", () => ({ loadTodoDetail: vi.fn() }));
vi.mock("../src/lib/d1/consumables", () => ({ listConsumablesForTaskRule: vi.fn() }));
vi.mock("../src/lib/d1/profiles", () => ({
  FALLBACK_OTHER_MEMBER_NAME: "メンバー",
  FALLBACK_SELF_ACTOR_NAME: "自分",
  loadActorName: vi.fn(),
  loadHouseholdMembers: vi.fn(),
}));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("../src/features/todos/actions/assignee", () => ({
  claimTaskOccurrenceAssignee: claimTaskOccurrenceAssigneeMock,
  setTaskOccurrenceAssignee: setTaskOccurrenceAssigneeMock,
}));
vi.mock("../src/features/todos/actions/completion", () => ({
  completeMaintenanceTask: completeMaintenanceTaskMock,
  undoMaintenanceTaskCompletion: undoMaintenanceTaskCompletionMock,
}));
vi.mock("../src/features/todos/actions/correction", () => ({
  correctCompletionOccurredAt: vi.fn(),
  correctCompletionPerformer: vi.fn(),
}));

import { TodoDetailContent, type TodoDetailData } from "../src/app/todos/[id]/page";

const MEMBERS = [
  { nickname: "ぽっぷ", userId: "user-1" },
  { nickname: "たろう", userId: "user-2" },
];

const TODO_TITLE = "フィルターの申請";

function todo(overrides: Partial<TodoDetailData> = {}): TodoDetailData {
  return {
    assigneeUserId: null,
    completion: null,
    consumables: [],
    dueAt: "2026-09-01T15:00:00.000Z",
    id: "occurrence-1",
    isCompleted: false,
    isMaintenance: false,
    managedItemId: "item-1",
    managedItemName: "猫の浄水器",
    recurrenceBasis: "once",
    recurrenceLabel: "繰り返しなし",
    scheduledFor: "2026-09-01T15:00:00.000Z",
    taskRuleId: "rule-1",
    title: TODO_TITLE,
    ...overrides,
  };
}

function renderDetail(data: TodoDetailData = todo()) {
  render(
    <TodoDetailContent
      actorName="ぽっぷ"
      currentUserId="user-1"
      members={MEMBERS}
      todo={data}
    />,
  );
}

function actionsSection() {
  return screen.getByRole("region", { name: "担当と完了" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("未完了Todoの詳細からの担当操作(Issue #392)", () => {
  it("現在の担当を選択済みで表示し、内容の一覧には担当を重ねて出さない", () => {
    renderDetail(todo({ assigneeUserId: "user-2" }));

    expect(screen.getByLabelText(`${TODO_TITLE}の担当`)).toHaveValue("user-2");
    // 現在値はselectが示すため、「Todoの内容」側に読み取り専用の担当行は出さない。
    const summary = screen.getByRole("region", { name: "Todoの内容" });
    expect(within(summary).queryByText("担当")).not.toBeInTheDocument();
  });

  it("担当を変更すると、同じOccurrenceと管理対象を渡して担当アクションを呼ぶ", () => {
    setTaskOccurrenceAssigneeMock.mockResolvedValue({
      message: "担当を変更しました。",
      status: "success",
    });
    renderDetail();

    fireEvent.change(screen.getByLabelText(`${TODO_TITLE}の担当`), {
      target: { value: "user-2" },
    });

    expect(setTaskOccurrenceAssigneeMock).toHaveBeenCalledTimes(1);
    expect(setTaskOccurrenceAssigneeMock).toHaveBeenCalledWith(
      "item-1",
      "occurrence-1",
      "user-2",
    );
  });

  it("担当未定のTodoでは「やるよ」で引き受けられる", () => {
    claimTaskOccurrenceAssigneeMock.mockResolvedValue({
      message: "担当にしました。",
      status: "success",
    });
    renderDetail();

    fireEvent.click(
      screen.getByRole("button", { name: `${TODO_TITLE}を自分の担当にする` }),
    );

    expect(claimTaskOccurrenceAssigneeMock).toHaveBeenCalledWith("item-1", "occurrence-1");
  });

  it("担当の変更が失敗すると、詳細画面にそのまま理由を表示する", async () => {
    setTaskOccurrenceAssigneeMock.mockResolvedValue({
      message: "すでに完了しています。最新の状態を確認してください。",
      status: "error",
    });
    renderDetail();

    fireEvent.change(screen.getByLabelText(`${TODO_TITLE}の担当`), {
      target: { value: "user-2" },
    });

    expect(
      await within(actionsSection()).findByRole("alert"),
    ).toHaveTextContent("すでに完了しています。最新の状態を確認してください。");
  });
});

describe("未完了Todoの詳細からの完了操作(Issue #392)", () => {
  it("既存と同じ確認手順(「やったよ」→ダイアログ)で完了を記録する", () => {
    completeMaintenanceTaskMock.mockResolvedValue({
      message: "完了を記録しました。",
      status: "success",
    });
    renderDetail();

    fireEvent.click(within(actionsSection()).getByRole("button", { name: `${TODO_TITLE}を記録` }));
    const dialog = screen.getByRole("dialog", { name: `${TODO_TITLE}を記録` });
    fireEvent.click(within(dialog).getByRole("button", { name: "今、自分がやった" }));

    expect(completeMaintenanceTaskMock).toHaveBeenCalledTimes(1);
    const [managedItemId, occurrenceId] = completeMaintenanceTaskMock.mock.calls[0] as [
      string,
      string,
    ];
    expect(managedItemId).toBe("item-1");
    expect(occurrenceId).toBe("occurrence-1");
    expect(
      screen.queryByRole("dialog", { name: `${TODO_TITLE}を記録` }),
    ).not.toBeInTheDocument();
  });

  it("確認ダイアログを閉じただけでは記録しない", () => {
    renderDetail();

    fireEvent.click(within(actionsSection()).getByRole("button", { name: `${TODO_TITLE}を記録` }));
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));

    expect(completeMaintenanceTaskMock).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("dialog", { name: `${TODO_TITLE}を記録` }),
    ).not.toBeInTheDocument();
  });

  it("完了の記録が失敗すると、詳細画面にそのまま理由を表示する", async () => {
    completeMaintenanceTaskMock.mockResolvedValue({
      message: "すでに完了しています。最新の状態を確認してください。",
      status: "error",
    });
    renderDetail();

    fireEvent.click(within(actionsSection()).getByRole("button", { name: `${TODO_TITLE}を記録` }));
    fireEvent.click(screen.getByRole("button", { name: "今、自分がやった" }));

    expect(
      await within(actionsSection()).findByRole("alert"),
    ).toHaveTextContent("すでに完了しています。最新の状態を確認してください。");
  });
});

describe("完了済みTodoの詳細(Issue #392で変えない部分)", () => {
  const completed = todo({
    assigneeUserId: "user-2",
    completion: {
      occurredAt: "2026-09-03T15:00:00.000Z",
      performedByUserId: "user-2",
      performerName: "たろう",
    },
    isCompleted: true,
  });

  it("担当と完了の操作は出さず、実施記録の修正・取消を従来どおり使える", () => {
    renderDetail(completed);

    expect(screen.queryByRole("region", { name: "担当と完了" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(`${TODO_TITLE}の担当`)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: `${TODO_TITLE}を記録` }),
    ).not.toBeInTheDocument();

    // 訂正・完了取消は従来どおり「修正」から開く(Issue #205)。
    const correction = screen.getByRole("region", { name: "実施記録を修正" });
    const correctionTrigger = within(correction)
      .getByRole("button", { name: `${TODO_TITLE}を修正` });
    fireEvent.click(correctionTrigger);
    expect(screen.getByRole("button", { name: "実施日時を訂正する" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完了を取り消す" })).toBeInTheDocument();
  });
});

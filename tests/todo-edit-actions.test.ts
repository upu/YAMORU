import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getD1ContextMock,
  redirectMock,
  revalidatePathMock,
  updateOneTimeTodoMock,
  updateRecurringOccurrenceMock,
  updateRecurringTaskRuleMock,
} = vi.hoisted(() => ({
  getD1ContextMock: vi.fn(),
  redirectMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  updateOneTimeTodoMock: vi.fn(),
  updateRecurringOccurrenceMock: vi.fn(),
  updateRecurringTaskRuleMock: vi.fn(),
}));

vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/todos", () => ({
  updateOneTimeTodo: updateOneTimeTodoMock,
  updateRecurringOccurrence: updateRecurringOccurrenceMock,
  updateRecurringTaskRule: updateRecurringTaskRuleMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import {
  updateRecurringOccurrence,
  updateRecurringRule,
  updateTodo,
} from "../src/app/todos/[id]/actions";
import { INITIAL_MAINTENANCE_TODO_STATE } from "../src/app/managed-items/[id]/state";

function editForm(overrides: Record<string, string> = {}): FormData {
  const formData = new FormData();
  const values: Record<string, string> = {
    assigneeUserId: "",
    id: "occurrence-1",
    managedItemId: "",
    plannedDate: "2026-09-02",
    title: "通知書が届いたら申請",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

async function submit(formData: FormData) {
  return updateTodo(INITIAL_MAINTENANCE_TODO_STATE, formData);
}

describe("Todoの編集(updateTodo)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    updateOneTimeTodoMock.mockResolvedValue({ previousManagedItemId: null });
  });

  it("予定日をAsia/Tokyoの日付として渡し、保存後にTodo詳細へ戻る", async () => {
    await submit(editForm({ assigneeUserId: "user-2", managedItemId: "item-1" }));

    expect(updateOneTimeTodoMock).toHaveBeenCalledWith("db", "session", "occurrence-1", {
      assigneeUserId: "user-2",
      managedItemId: "item-1",
      scheduledFor: "2026-09-01T15:00:00.000Z",
      title: "通知書が届いたら申請",
    });
    expect(redirectMock).toHaveBeenCalledWith("/todos/occurrence-1");
  });

  it("空欄の予定日は未定として渡す", async () => {
    await submit(editForm({ plannedDate: "" }));

    expect(updateOneTimeTodoMock).toHaveBeenCalledWith(
      "db",
      "session",
      "occurrence-1",
      expect.objectContaining({ scheduledFor: null }),
    );
  });

  it("担当と管理対象の空欄は未設定として渡す", async () => {
    await submit(editForm());

    expect(updateOneTimeTodoMock).toHaveBeenCalledWith(
      "db",
      "session",
      "occurrence-1",
      expect.objectContaining({ assigneeUserId: null, managedItemId: null }),
    );
  });

  it("Todo名の前後の空白を落とし、空欄は保存しない", async () => {
    await submit(editForm({ title: "  申請する  " }));
    expect(updateOneTimeTodoMock).toHaveBeenCalledWith(
      "db",
      "session",
      "occurrence-1",
      expect.objectContaining({ title: "申請する" }),
    );

    vi.clearAllMocks();
    const result = await submit(editForm({ title: "   " }));
    expect(result).toEqual({
      message: "Todo名は1文字以上100文字以内で入力してください。",
      status: "error",
    });
    expect(getD1ContextMock).not.toHaveBeenCalled();
  });

  it("不正な予定日はD1へ送らない", async () => {
    const result = await submit(editForm({ plannedDate: "not-a-date" }));

    expect(result).toEqual({ message: "予定日を正しく入力してください。", status: "error" });
    expect(getD1ContextMock).not.toHaveBeenCalled();
  });

  it("変更前後の管理対象と、ホーム・Todo一覧・Todo詳細を再検証する", async () => {
    updateOneTimeTodoMock.mockResolvedValue({ previousManagedItemId: "item-old" });

    await submit(editForm({ managedItemId: "item-new" }));

    for (const path of [
      "/",
      "/todos",
      "/todos/occurrence-1",
      "/todos/occurrence-1/edit",
      "/managed-items/item-old",
      "/managed-items/item-new",
    ]) {
      expect(revalidatePathMock).toHaveBeenCalledWith(path);
    }
  });

  it.each([
    ["Assignee not found", "担当者を指定できませんでした。同じ家庭のメンバーから選び直してください。"],
    ["Managed item not found", "関連する管理対象を指定できませんでした。同じ家庭の管理対象から選び直してください。"],
    ["Only one-time tasks can be edited", "繰り返しTodoの内容はこの画面から変更できません。"],
    ["Occurrence not found", "対象のTodoが見つかりませんでした。最新の状態を確認してください。"],
    ["Occurrence is not pending", "他の操作で状態が変わりました。最新の状態を確認してください。"],
    [
      "Occurrence already exists for the schedule",
      "その予定日には同じTodoの別の予定があります。別の日付を指定してください。",
    ],
  ])("D1の既知エラー %s を利用者向け案内へ変換する", async (message, expected) => {
    updateOneTimeTodoMock.mockRejectedValue(new Error(message));

    const result = await submit(editForm());

    expect(result).toEqual({ message: expected, status: "error" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("それ以外の失敗では内部詳細を表示しない", async () => {
    updateOneTimeTodoMock.mockRejectedValue(new Error("D1_ERROR: something internal"));

    const result = await submit(editForm());

    expect(result).toEqual({
      message: "Todoを更新できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
  });

  it("対象のTodoが指定されていない場合はD1へ送らない", async () => {
    const result = await submit(editForm({ id: "" }));

    expect(result).toEqual({ message: "対象のTodoを特定できませんでした。", status: "error" });
    expect(getD1ContextMock).not.toHaveBeenCalled();
  });
});

describe("繰り返しTodoの編集", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    updateRecurringOccurrenceMock.mockResolvedValue(undefined);
    updateRecurringTaskRuleMock.mockResolvedValue({ previousManagedItemId: null });
  });

  it("今回の担当と現在期限をD1へ渡す", async () => {
    const formData = new FormData();
    formData.set("id", "occurrence-1");
    formData.set("assigneeUserId", "user-2");
    formData.set("dueDate", "2026-09-20");

    await updateRecurringOccurrence(INITIAL_MAINTENANCE_TODO_STATE, formData);

    expect(updateRecurringOccurrenceMock).toHaveBeenCalledWith(
      "db",
      "session",
      "occurrence-1",
      {
        assigneeUserId: "user-2",
        dueAt: "2026-09-19T15:00:00.000Z",
      },
    );
    expect(redirectMock).toHaveBeenCalledWith("/todos/occurrence-1");
  });

  it("定例日ルールの入力を現在の方式のままD1へ渡す", async () => {
    const formData = new FormData();
    for (const [key, value] of Object.entries({
      id: "occurrence-1",
      managedItemId: "item-1",
      recurrenceBasis: "calendar",
      scheduleDayOfWeek: "2",
      scheduleKind: "weekly",
      title: "毎週火曜の家族会議",
    })) formData.set(key, value);

    await updateRecurringRule(INITIAL_MAINTENANCE_TODO_STATE, formData);

    expect(updateRecurringTaskRuleMock).toHaveBeenCalledWith(
      "db",
      "session",
      "occurrence-1",
      {
        managedItemId: "item-1",
        recurrenceBasis: "calendar",
        scheduleDayOfMonth: null,
        scheduleDayOfWeek: 2,
        scheduleKind: "weekly",
        scheduleMonth: null,
        scheduleMonthEnd: false,
        scheduleWeekOfMonth: null,
        title: "毎週火曜の家族会議",
      },
    );
  });

  it("完了日基準の値・単位を検証してD1へ渡す", async () => {
    const formData = new FormData();
    for (const [key, value] of Object.entries({
      id: "occurrence-1",
      intervalMax: "2",
      intervalMin: "1",
      intervalUnit: "month",
      managedItemId: "",
      recurrenceBasis: "completion",
      title: "フィルター交換",
    })) formData.set(key, value);

    await updateRecurringRule(INITIAL_MAINTENANCE_TODO_STATE, formData);

    expect(updateRecurringTaskRuleMock).toHaveBeenCalledWith(
      "db",
      "session",
      "occurrence-1",
      expect.objectContaining({
        recommendedStartOffset: 0,
        recommendedStartValue: 1,
        recommendedUnit: "month",
        recommendedUntilOffset: 0,
        recommendedUntilValue: 2,
      }),
    );
  });

  it("不正な固定間隔はD1へ送らない", async () => {
    const formData = new FormData();
    for (const [key, value] of Object.entries({
      fixedIntervalAnchorDate: "2026-09-01",
      fixedIntervalCount: "0",
      fixedIntervalUnit: "day",
      id: "occurrence-1",
      managedItemId: "",
      recurrenceBasis: "interval",
      title: "確認",
    })) formData.set(key, value);

    const result = await updateRecurringRule(
      INITIAL_MAINTENANCE_TODO_STATE,
      formData,
    );

    expect(result).toEqual({
      message: "繰り返す間隔と起点日を正しく入力してください。",
      status: "error",
    });
    expect(updateRecurringTaskRuleMock).not.toHaveBeenCalled();
  });
});

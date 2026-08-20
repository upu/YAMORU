import { beforeEach, describe, expect, it, vi } from "vitest";

const { createOneTimeTaskMock, getD1ContextMock, revalidatePathMock } = vi.hoisted(() => ({
  createOneTimeTaskMock: vi.fn(),
  getD1ContextMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("../lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../lib/d1/todos", () => ({
  createCalendarTask: vi.fn(),
  createMaintenanceTask: vi.fn(),
  createOneTimeTask: createOneTimeTaskMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

import { createTodo } from "../app/todos/new/actions";

const INITIAL_STATE = { message: "", status: "idle" } as const;

function todoForm({
  managedItemId = "",
  plannedDate = "2026-10-10",
  title = "家族会議",
}: {
  managedItemId?: string;
  plannedDate?: string;
  title?: string;
} = {}) {
  const formData = new FormData();
  formData.set("title", title);
  formData.set("plannedDate", plannedDate);
  formData.set("managedItemId", managedItemId);
  formData.set("recurrenceBasis", "once");
  return formData;
}

describe("専用ページの一回限りTodo登録操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    createOneTimeTaskMock.mockResolvedValue("task-rule-id");
  });

  it("管理対象なしでは一回限りTodoを家庭へ登録する", async () => {
    const result = await createTodo(INITIAL_STATE, todoForm());

    expect(createOneTimeTaskMock).toHaveBeenCalledWith("db", "session", {
      managedItemId: null,
      recurrenceBasis: "once",
      scheduledFor: "2026-10-09T15:00:00.000Z",
      title: "家族会議",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(result).toEqual({
      message: "Todoを登録しました。",
      status: "success",
    });
  });

  it("管理対象を選ぶと同じ入口から関連付けて登録する", async () => {
    await createTodo(
      INITIAL_STATE,
      todoForm({ managedItemId: "managed-item-id", title: "今回だけ点検" }),
    );

    expect(createOneTimeTaskMock).toHaveBeenCalledWith("db", "session", {
      managedItemId: "managed-item-id",
      recurrenceBasis: "once",
      scheduledFor: "2026-10-09T15:00:00.000Z",
      title: "今回だけ点検",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/managed-items/managed-item-id");
  });

  it.each(["", "   ", "あ".repeat(101)])(
    "無効なTodo名(%s)はRPCへ送らない",
    async (title) => {
      const result = await createTodo(INITIAL_STATE, todoForm({ title }));

      expect(getD1ContextMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: "Todo名は1文字以上100文字以内で入力してください。",
        status: "error",
      });
    },
  );

  it.each(["", "2026-02-30"])(
    "無効な予定日(%s)はRPCへ送らない",
    async (plannedDate) => {
      const result = await createTodo(
        INITIAL_STATE,
        todoForm({ plannedDate }),
      );

      expect(getD1ContextMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: "予定日を正しく入力してください。",
        status: "error",
      });
    },
  );

  it("保存失敗では内部詳細を表示せず再試行を案内する", async () => {
    createOneTimeTaskMock.mockRejectedValue(new Error("sensitive database detail"));

    const result = await createTodo(INITIAL_STATE, todoForm());

    expect(result).toEqual({
      message: "Todoを登録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    expect(result.message).not.toContain("sensitive database detail");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, revalidatePathMock, rpcMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("../lib/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

import { createOneTimeTodo } from "../app/actions";

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
  return formData;
}

describe("ホームの一回限りTodo登録操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue({ rpc: rpcMock });
    rpcMock.mockResolvedValue({ data: "task-rule-id", error: null });
  });

  it("管理対象なしでは一回限りTodoを家庭へ登録する", async () => {
    const result = await createOneTimeTodo(INITIAL_STATE, todoForm());

    expect(rpcMock).toHaveBeenCalledWith("create_one_time_task", {
      scheduled_for: "2026-10-09T15:00:00.000Z",
      task_title: "家族会議",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(result).toEqual({
      message: "Todoを登録しました。",
      status: "success",
    });
  });

  it("管理対象を選ぶと同じ入口から関連付けて登録する", async () => {
    await createOneTimeTodo(
      INITIAL_STATE,
      todoForm({ managedItemId: "managed-item-id", title: "今回だけ点検" }),
    );

    expect(rpcMock).toHaveBeenCalledWith("create_one_time_task", {
      item_id: "managed-item-id",
      scheduled_for: "2026-10-09T15:00:00.000Z",
      task_title: "今回だけ点検",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/managed-items/managed-item-id");
  });

  it.each(["", "   ", "あ".repeat(101)])(
    "無効なTodo名(%s)はRPCへ送らない",
    async (title) => {
      const result = await createOneTimeTodo(INITIAL_STATE, todoForm({ title }));

      expect(createClientMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: "Todo名は1文字以上100文字以内で入力してください。",
        status: "error",
      });
    },
  );

  it.each(["", "2026-02-30"])(
    "無効な予定日(%s)はRPCへ送らない",
    async (plannedDate) => {
      const result = await createOneTimeTodo(
        INITIAL_STATE,
        todoForm({ plannedDate }),
      );

      expect(createClientMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: "予定日を正しく入力してください。",
        status: "error",
      });
    },
  );

  it("保存失敗では内部詳細を表示せず再試行を案内する", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: new Error("sensitive database detail"),
    });

    const result = await createOneTimeTodo(INITIAL_STATE, todoForm());

    expect(result).toEqual({
      message: "Todoを登録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    expect(result.message).not.toContain("sensitive database detail");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

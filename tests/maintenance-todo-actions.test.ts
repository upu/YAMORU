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

import { createMaintenanceTodo } from "../app/managed-items/[id]/actions";

const INITIAL_STATE = { message: "", status: "idle" } as const;

function maintenanceTodoForm({
  anchorDate = "2026-10-01",
  initialDateMode = "previous_completion",
  intervalMax = "2",
  intervalMin = "1",
  intervalUnit = "week",
  plannedDate = "2026-10-10",
  recurrenceBasis = "completion",
  title = "フィルター交換",
}: {
  anchorDate?: string;
  initialDateMode?: string;
  intervalMax?: string;
  intervalMin?: string;
  intervalUnit?: string;
  plannedDate?: string;
  recurrenceBasis?: string;
  title?: string;
} = {}) {
  const formData = new FormData();
  formData.set("title", title);
  formData.set("intervalMin", intervalMin);
  formData.set("intervalMax", intervalMax);
  formData.set("intervalUnit", intervalUnit);
  formData.set("initialDateMode", initialDateMode);
  formData.set("anchorDate", anchorDate);
  formData.set("plannedDate", plannedDate);
  formData.set("recurrenceBasis", recurrenceBasis);
  return formData;
}

describe("完了日基準メンテナンスTodo登録操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue({ rpc: rpcMock });
    rpcMock.mockResolvedValue({ data: "task-rule-id", error: null });
  });

  it("1〜2週間と前回実施日から初回期間を計算して限定RPCへ渡す", async () => {
    const result = await createMaintenanceTodo(
      "managed-item-id",
      INITIAL_STATE,
      maintenanceTodoForm({ title: "  フィルター交換  " }),
    );

    expect(rpcMock).toHaveBeenCalledWith("create_maintenance_task", {
      first_due_at: "2026-10-14T15:00:00.000Z",
      first_scheduled_for: "2026-10-07T15:00:00.000Z",
      item_id: "managed-item-id",
      recommended_start_offset: 7,
      recommended_until_offset: 14,
      task_title: "フィルター交換",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/managed-items/managed-item-id",
    );
    expect(result).toEqual({
      message: "メンテナンスTodoを登録しました。",
      status: "success",
    });
  });

  it("次回の目安開始日を指定した場合は上限日だけを自動計算する", async () => {
    await createMaintenanceTodo(
      "managed-item-id",
      INITIAL_STATE,
      maintenanceTodoForm({
        anchorDate: "2026-10-09",
        initialDateMode: "next_window_start",
      }),
    );

    expect(rpcMock).toHaveBeenCalledWith(
      "create_maintenance_task",
      expect.objectContaining({
        first_due_at: "2026-10-15T15:00:00.000Z",
        first_scheduled_for: "2026-10-08T15:00:00.000Z",
      }),
    );
  });

  it("一回限りでは予定日を限定RPCへ渡し、完了日基準の間隔を送らない", async () => {
    const result = await createMaintenanceTodo(
      "managed-item-id",
      INITIAL_STATE,
      maintenanceTodoForm({
        plannedDate: "2026-10-10",
        recurrenceBasis: "once",
        title: "  今回だけ点検  ",
      }),
    );

    expect(rpcMock).toHaveBeenCalledWith("create_one_time_task", {
      item_id: "managed-item-id",
      scheduled_for: "2026-10-09T15:00:00.000Z",
      task_title: "今回だけ点検",
    });
    expect(result).toEqual({
      message: "繰り返しなしのTodoを登録しました。",
      status: "success",
    });
  });

  it.each(["", "   ", "あ".repeat(101)])(
    "無効なTodo名(%s)はRPCへ送らない",
    async (title) => {
      const result = await createMaintenanceTodo(
        "managed-item-id",
        INITIAL_STATE,
        maintenanceTodoForm({ title }),
      );

      expect(createClientMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: "Todo名は1文字以上100文字以内で入力してください。",
        status: "error",
      });
    },
  );

  it.each([
    ["-1", "2", "week"],
    ["1.5", "2", "week"],
    ["2", "1", "week"],
    ["1", "3651", "day"],
    ["1", "2", "month"],
  ])(
    "無効な次回の目安(%s, %s, %s)はRPCへ送らない",
    async (intervalMin, intervalMax, intervalUnit) => {
      const result = await createMaintenanceTodo(
        "managed-item-id",
        INITIAL_STATE,
        maintenanceTodoForm({ intervalMax, intervalMin, intervalUnit }),
      );

      expect(createClientMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: "次回の目安は0以上の整数で、短い方を長い方以下にしてください。",
        status: "error",
      });
    },
  );

  it.each(["", "2026-02-30"])(
    "無効な初回日付(%s)はRPCへ送らない",
    async (anchorDate) => {
      const result = await createMaintenanceTodo(
        "managed-item-id",
        INITIAL_STATE,
        maintenanceTodoForm({ anchorDate }),
      );

      expect(createClientMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: "初回の計算に使う有効な日付を入力してください。",
        status: "error",
      });
    },
  );

  it("未定義の初回日付モードはRPCへ送らない", async () => {
    const result = await createMaintenanceTodo(
      "managed-item-id",
      INITIAL_STATE,
      maintenanceTodoForm({ initialDateMode: "secret_mode" }),
    );

    expect(createClientMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "初回の決め方を選択してください。",
      status: "error",
    });
  });

  it.each(["", "2026-02-30"])(
    "一回限りの無効な予定日(%s)はRPCへ送らない",
    async (plannedDate) => {
      const result = await createMaintenanceTodo(
        "managed-item-id",
        INITIAL_STATE,
        maintenanceTodoForm({ plannedDate, recurrenceBasis: "once" }),
      );

      expect(createClientMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: "予定日を正しく入力してください。",
        status: "error",
      });
    },
  );

  it("未定義の繰り返し方はRPCへ送らない", async () => {
    const result = await createMaintenanceTodo(
      "managed-item-id",
      INITIAL_STATE,
      maintenanceTodoForm({ recurrenceBasis: "secret_mode" }),
    );

    expect(createClientMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "繰り返し方を選択してください。",
      status: "error",
    });
  });

  it("保存失敗の内部詳細を表示せず再試行できる案内を返す", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: new Error("sensitive database detail"),
    });

    const result = await createMaintenanceTodo(
      "managed-item-id",
      INITIAL_STATE,
      maintenanceTodoForm(),
    );

    expect(result).toEqual({
      message: "メンテナンスTodoを登録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    expect(result.message).not.toContain("sensitive database detail");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

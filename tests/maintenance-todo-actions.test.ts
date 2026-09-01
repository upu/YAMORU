import { beforeEach, describe, expect, it, vi } from "vitest";

const { createMaintenanceTaskMock, createOneTimeTaskMock, getD1ContextMock, revalidatePathMock } = vi.hoisted(() => ({
  createMaintenanceTaskMock: vi.fn(),
  createOneTimeTaskMock: vi.fn(),
  getD1ContextMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/todos", () => ({
  createCalendarTask: vi.fn(),
  createMaintenanceTask: createMaintenanceTaskMock,
  createOneTimeTask: createOneTimeTaskMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

import { createTodo } from "../src/app/todos/new/actions";

const INITIAL_STATE = { message: "", status: "idle" } as const;

function maintenanceTodoForm({
  anchorDate = "2026-10-01",
  initialDateMode = "previous_completion",
  intervalMax = "2",
  intervalMin = "1",
  intervalUnit = "week",
  managedItemId = "managed-item-id",
  plannedDate = "2026-10-10",
  recurrenceBasis = "completion",
  title = "フィルター交換",
}: {
  anchorDate?: string;
  initialDateMode?: string;
  intervalMax?: string;
  intervalMin?: string;
  intervalUnit?: string;
  managedItemId?: string;
  plannedDate?: string;
  recurrenceBasis?: string;
  title?: string;
} = {}) {
  const formData = new FormData();
  formData.set("title", title);
  formData.set("intervalMin", intervalMin);
  formData.set("intervalMax", intervalMax);
  formData.set("intervalUnit", intervalUnit);
  formData.set("managedItemId", managedItemId);
  formData.set("initialDateMode", initialDateMode);
  formData.set("anchorDate", anchorDate);
  formData.set("plannedDate", plannedDate);
  formData.set("recurrenceBasis", recurrenceBasis);
  return formData;
}

describe("完了日基準メンテナンスTodo登録操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    createMaintenanceTaskMock.mockResolvedValue("task-rule-id");
    createOneTimeTaskMock.mockResolvedValue("task-rule-id");
  });

  it("1〜2週間と前回実施日から初回期間を計算して限定RPCへ渡す", async () => {
    const result = await createTodo(
      INITIAL_STATE,
      maintenanceTodoForm({ title: "  フィルター交換  " }),
    );

    expect(createMaintenanceTaskMock).toHaveBeenCalledWith("db", "session", {
      firstDueAt: "2026-10-14T15:00:00.000Z",
      firstScheduledFor: "2026-10-07T15:00:00.000Z",
      managedItemId: "managed-item-id",
      recurrenceBasis: "completion",
      recommendedStartOffset: 7,
      recommendedStartValue: 1,
      recommendedUnit: "week",
      recommendedUntilOffset: 14,
      recommendedUntilValue: 2,
      title: "フィルター交換",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/managed-items/managed-item-id",
    );
    expect(result).toEqual({
      message: "Todoを登録しました。",
      status: "success",
    });
  });

  it("次回の目安開始日を指定した場合は上限日だけを自動計算する", async () => {
    await createTodo(
      INITIAL_STATE,
      maintenanceTodoForm({
        anchorDate: "2026-10-09",
        initialDateMode: "next_window_start",
      }),
    );

    expect(createMaintenanceTaskMock).toHaveBeenCalledWith(
      "db",
      "session",
      expect.objectContaining({
        firstDueAt: "2026-10-15T15:00:00.000Z",
        firstScheduledFor: "2026-10-08T15:00:00.000Z",
      }),
    );
  });

  it("一回限りでは予定日を限定RPCへ渡し、完了日基準の間隔を送らない", async () => {
    const result = await createTodo(
      INITIAL_STATE,
      maintenanceTodoForm({
        plannedDate: "2026-10-10",
        recurrenceBasis: "once",
        title: "  今回だけ点検  ",
      }),
    );

    expect(createOneTimeTaskMock).toHaveBeenCalledWith("db", "session", {
      managedItemId: "managed-item-id",
      recurrenceBasis: "once",
      scheduledFor: "2026-10-09T15:00:00.000Z",
      title: "今回だけ点検",
    });
    expect(result).toEqual({
      message: "Todoを登録しました。",
      status: "success",
    });
  });

  it.each(["", "   ", "あ".repeat(101)])(
    "無効なTodo名(%s)はRPCへ送らない",
    async (title) => {
      const result = await createTodo(
        INITIAL_STATE,
        maintenanceTodoForm({ title }),
      );

      expect(getD1ContextMock).not.toHaveBeenCalled();
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
    ["1", "2", "quarter"],
  ])(
    "無効な次回の目安(%s, %s, %s)はRPCへ送らない",
    async (intervalMin, intervalMax, intervalUnit) => {
      const result = await createTodo(
        INITIAL_STATE,
        maintenanceTodoForm({ intervalMax, intervalMin, intervalUnit }),
      );

      expect(getD1ContextMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: "次回の目安は0以上の整数で、短い方を長い方以下にしてください。",
        status: "error",
      });
    },
  );

  it.each(["", "2026-02-30"])(
    "無効な初回日付(%s)はRPCへ送らない",
    async (anchorDate) => {
      const result = await createTodo(
        INITIAL_STATE,
        maintenanceTodoForm({ anchorDate }),
      );

      expect(getD1ContextMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: "初回の計算に使う有効な日付を入力してください。",
        status: "error",
      });
    },
  );

  it("未定義の初回日付モードはRPCへ送らない", async () => {
    const result = await createTodo(
      INITIAL_STATE,
      maintenanceTodoForm({ initialDateMode: "secret_mode" }),
    );

    expect(getD1ContextMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "初回の決め方を選択してください。",
      status: "error",
    });
  });

  it.each(["2026-02-30"])(
    "一回限りの無効な予定日(%s)はRPCへ送らない",
    async (plannedDate) => {
      const result = await createTodo(
        INITIAL_STATE,
        maintenanceTodoForm({ plannedDate, recurrenceBasis: "once" }),
      );

      expect(getD1ContextMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: "予定日を正しく入力してください。",
        status: "error",
      });
    },
  );

  it("未定義の繰り返し方はRPCへ送らない", async () => {
    const result = await createTodo(
      INITIAL_STATE,
      maintenanceTodoForm({ recurrenceBasis: "secret_mode" }),
    );

    expect(getD1ContextMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "繰り返し方を選択してください。",
      status: "error",
    });
  });

  it("保存失敗の内部詳細を表示せず再試行できる案内を返す", async () => {
    createMaintenanceTaskMock.mockRejectedValue(new Error("sensitive database detail"));

    const result = await createTodo(
      INITIAL_STATE,
      maintenanceTodoForm(),
    );

    expect(result).toEqual({
      message: "Todoを登録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    });
    expect(result.message).not.toContain("sensitive database detail");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

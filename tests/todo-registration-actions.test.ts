import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, revalidatePathMock, rpcMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("../lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { createTodo } from "../app/todos/new/actions";

const INITIAL_STATE = { message: "", status: "idle" } as const;
const INVALID_CALENDAR_CASES: Record<string, string>[] = [
  { scheduleDayOfWeek: "0", scheduleKind: "weekly" },
  { scheduleDayOfMonth: "32", scheduleKind: "monthly_day" },
  { scheduleKind: "monthly_nth_weekday", scheduleWeekOfMonth: "6" },
  { scheduleDayOfMonth: "30", scheduleKind: "yearly", scheduleMonth: "2" },
];

function todoForm(overrides: Record<string, string> = {}) {
  const values = {
    anchorDate: "2026-10-01",
    initialDateMode: "previous_completion",
    intervalMax: "2",
    intervalMin: "1",
    intervalUnit: "week",
    managedItemId: "",
    plannedDate: "2026-10-10",
    recurrenceBasis: "once",
    scheduleDayOfMonth: "25",
    scheduleDayOfWeek: "1",
    scheduleKind: "weekly",
    scheduleMonth: "8",
    scheduleWeekOfMonth: "2",
    title: "家族会議",
    ...overrides,
  };
  const formData = new FormData();
  Object.entries(values).forEach(([key, value]) => { formData.set(key, value); });
  return formData;
}

describe("専用ページのTodo登録操作", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue({ rpc: rpcMock });
    rpcMock.mockResolvedValue({ data: "task-rule-id", error: null });
  });

  it("管理対象なしの一回限りTodoを登録する", async () => {
    const result = await createTodo(INITIAL_STATE, todoForm());

    expect(rpcMock).toHaveBeenCalledWith("create_one_time_task", {
      scheduled_for: "2026-10-09T15:00:00.000Z",
      task_title: "家族会議",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(revalidatePathMock).toHaveBeenCalledWith("/todos/new");
    expect(result).toEqual({ message: "Todoを登録しました。", status: "success" });
  });

  it("管理対象なしの完了日基準Todoを登録する", async () => {
    await createTodo(
      INITIAL_STATE,
      todoForm({ recurrenceBasis: "completion", title: "換気扇の掃除" }),
    );

    expect(rpcMock).toHaveBeenCalledWith("create_maintenance_task", {
      first_due_at: "2026-10-14T15:00:00.000Z",
      first_scheduled_for: "2026-10-07T15:00:00.000Z",
      recommended_start_offset: 7,
      recommended_until_offset: 14,
      task_title: "換気扇の掃除",
    });
  });

  it("選んだ管理対象を同じ登録処理へ渡す", async () => {
    await createTodo(
      INITIAL_STATE,
      todoForm({ managedItemId: "item-1", recurrenceBasis: "completion" }),
    );

    expect(rpcMock).toHaveBeenCalledWith(
      "create_maintenance_task",
      expect.objectContaining({ item_id: "item-1" }),
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/managed-items/item-1");
  });

  it("管理対象なしの週次定例Todoを登録する", async () => {
    await createTodo(
      INITIAL_STATE,
      todoForm({ recurrenceBasis: "calendar", scheduleDayOfWeek: "3" }),
    );

    expect(rpcMock).toHaveBeenCalledWith("create_calendar_task", {
      schedule_day_of_week: 3,
      schedule_kind: "weekly",
      task_title: "家族会議",
    });
  });

  it.each([
    ["monthly_day", { schedule_day_of_month: 31 }],
    [
      "monthly_nth_weekday",
      { schedule_day_of_week: 2, schedule_week_of_month: 5 },
    ],
    ["yearly", { schedule_day_of_month: 29, schedule_month: 2 }],
  ])("%sの構造化された暦規則をRPCへ渡す", async (scheduleKind, expected) => {
    await createTodo(
      INITIAL_STATE,
      todoForm({
        recurrenceBasis: "calendar",
        scheduleDayOfMonth: scheduleKind === "monthly_day" ? "31" : "29",
        scheduleDayOfWeek: "2",
        scheduleKind,
        scheduleMonth: "2",
        scheduleWeekOfMonth: "5",
      }),
    );

    expect(rpcMock).toHaveBeenCalledWith("create_calendar_task", {
      ...expected,
      schedule_kind: scheduleKind,
      task_title: "家族会議",
    });
  });

  it("管理対象ありの定例Todoは選んだ管理対象をRPCへ渡す", async () => {
    await createTodo(
      INITIAL_STATE,
      todoForm({
        managedItemId: "item-1",
        recurrenceBasis: "calendar",
      }),
    );

    expect(rpcMock).toHaveBeenCalledWith(
      "create_calendar_task",
      expect.objectContaining({ item_id: "item-1" }),
    );
  });

  it.each(INVALID_CALENDAR_CASES)("無効な暦規則はRPCへ送らない", async (overrides) => {
    const result = await createTodo(
      INITIAL_STATE,
      todoForm({ recurrenceBasis: "calendar", ...overrides }),
    );

    expect(createClientMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "定例日の指定を正しく入力してください。",
      status: "error",
    });
  });

  it("未定義の繰り返し方はRPCへ送らない", async () => {
    const result = await createTodo(
      INITIAL_STATE,
      todoForm({ recurrenceBasis: "secret_mode" }),
    );

    expect(createClientMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "繰り返し方を選択してください。",
      status: "error",
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createCalendarTaskMock,
  createMaintenanceTaskMock,
  createOneTimeTaskMock,
  getD1ContextMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  createCalendarTaskMock: vi.fn(),
  createMaintenanceTaskMock: vi.fn(),
  createOneTimeTaskMock: vi.fn(),
  getD1ContextMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/todos", () => ({
  createCalendarTask: createCalendarTaskMock,
  createMaintenanceTask: createMaintenanceTaskMock,
  createOneTimeTask: createOneTimeTaskMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { createTodo } from "../src/app/todos/new/actions";

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
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    createCalendarTaskMock.mockResolvedValue("task-rule-id");
    createMaintenanceTaskMock.mockResolvedValue("task-rule-id");
    createOneTimeTaskMock.mockResolvedValue("task-rule-id");
  });

  it("管理対象なしの一回限りTodoを登録する", async () => {
    const result = await createTodo(INITIAL_STATE, todoForm());

    expect(createOneTimeTaskMock).toHaveBeenCalledWith("db", "session", {
      managedItemId: null,
      recurrenceBasis: "once",
      scheduledFor: "2026-10-09T15:00:00.000Z",
      title: "家族会議",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    // 登録直後のTodoは、ホームに載らない予定でもTodo一覧には載る(Issue #201)。
    expect(revalidatePathMock).toHaveBeenCalledWith("/todos");
    expect(revalidatePathMock).toHaveBeenCalledWith("/todos/new");
    expect(result).toEqual({ message: "Todoを登録しました。", status: "success" });
  });

  it("一回限りTodoは予定日を空欄のまま登録できる", async () => {
    const result = await createTodo(INITIAL_STATE, todoForm({ plannedDate: "" }));

    expect(createOneTimeTaskMock).toHaveBeenCalledWith("db", "session", {
      managedItemId: null,
      recurrenceBasis: "once",
      scheduledFor: null,
      title: "家族会議",
    });
    expect(result).toEqual({ message: "Todoを登録しました。", status: "success" });
  });

  it("管理対象なしの完了日基準Todoを登録する", async () => {
    await createTodo(
      INITIAL_STATE,
      todoForm({ recurrenceBasis: "completion", title: "換気扇の掃除" }),
    );

    expect(createMaintenanceTaskMock).toHaveBeenCalledWith("db", "session", {
      firstDueAt: "2026-10-14T15:00:00.000Z",
      firstScheduledFor: "2026-10-07T15:00:00.000Z",
      managedItemId: null,
      recurrenceBasis: "completion",
      recommendedStartOffset: 7,
      recommendedUntilOffset: 14,
      title: "換気扇の掃除",
    });
  });

  it("選んだ管理対象を同じ登録処理へ渡す", async () => {
    await createTodo(
      INITIAL_STATE,
      todoForm({ managedItemId: "item-1", recurrenceBasis: "completion" }),
    );

    expect(createMaintenanceTaskMock).toHaveBeenCalledWith(
      "db",
      "session",
      expect.objectContaining({ managedItemId: "item-1" }),
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/managed-items/item-1");
  });

  it("管理対象なしの週次定例Todoを登録する", async () => {
    await createTodo(
      INITIAL_STATE,
      todoForm({ recurrenceBasis: "calendar", scheduleDayOfWeek: "3" }),
    );

    expect(createCalendarTaskMock).toHaveBeenCalledWith("db", "session", {
      managedItemId: null,
      recurrenceBasis: "calendar",
      scheduleDayOfMonth: null,
      scheduleDayOfWeek: 3,
      scheduleKind: "weekly",
      scheduleMonth: null,
      scheduleWeekOfMonth: null,
      title: "家族会議",
    });
  });

  it.each([
    ["monthly_day", { scheduleDayOfMonth: 31 }],
    [
      "monthly_nth_weekday",
      { scheduleDayOfWeek: 2, scheduleWeekOfMonth: 5 },
    ],
    ["yearly", { scheduleDayOfMonth: 29, scheduleMonth: 2 }],
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

    expect(createCalendarTaskMock).toHaveBeenCalledWith("db", "session", {
      managedItemId: null,
      recurrenceBasis: "calendar",
      scheduleDayOfMonth: null,
      scheduleDayOfWeek: null,
      scheduleKind,
      scheduleMonth: null,
      scheduleWeekOfMonth: null,
      title: "家族会議",
      ...expected,
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

    expect(createCalendarTaskMock).toHaveBeenCalledWith(
      "db",
      "session",
      expect.objectContaining({ managedItemId: "item-1" }),
    );
  });

  it.each(INVALID_CALENDAR_CASES)("無効な暦規則はRPCへ送らない", async (overrides) => {
    const result = await createTodo(
      INITIAL_STATE,
      todoForm({ recurrenceBasis: "calendar", ...overrides }),
    );

    expect(getD1ContextMock).not.toHaveBeenCalled();
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

    expect(getD1ContextMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "繰り返し方を選択してください。",
      status: "error",
    });
  });
});

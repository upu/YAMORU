import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createCalendarTaskMock,
  createIntervalTaskMock,
  createMaintenanceTaskMock,
  createOneTimeTaskMock,
  getD1ContextMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  createCalendarTaskMock: vi.fn(),
  createIntervalTaskMock: vi.fn(),
  createMaintenanceTaskMock: vi.fn(),
  createOneTimeTaskMock: vi.fn(),
  getD1ContextMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/todos", () => ({
  createCalendarTask: createCalendarTaskMock,
  createIntervalTask: createIntervalTaskMock,
  createMaintenanceTask: createMaintenanceTaskMock,
  createOneTimeTask: createOneTimeTaskMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { createTodo } from "../src/app/todos/new/actions";

const INITIAL_STATE = { message: "", status: "idle" } as const;
const INVALID_CALENDAR_CASES: Record<string, string | string[]>[] = [
  { scheduleDaysOfWeek: ["0"], scheduleKind: "weekly" },
  { scheduleDayOfMonth: "32", scheduleKind: "monthly_day" },
  { scheduleKind: "monthly_nth_weekday", scheduleWeekOfMonth: "6" },
  { scheduleDayOfMonth: "30", scheduleKind: "yearly", scheduleMonth: "2" },
  {
    scheduleKind: "yearly_nth_weekday",
    scheduleMonth: "11",
    scheduleWeekOfMonth: "6",
  },
];

// Issue #99 / YDR-037: 起点日の受け付け範囲は登録日の前後3650日。日付を
// リテラルで書くとその日を過ぎたときに落ちるため、実行日から求める。
// 受け付け範囲はAsia/Tokyoの暦日で数えるため、UTCの日付ではなく東京の
// 今日から数える(そうしないと15:00Z以降で境界が1日ずれる)。
function tokyoDateFromNow(days: number): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Tokyo",
    year: "numeric",
  }).format(new Date());
  const base = new Date(`${today}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function todoForm(overrides: Record<string, string | string[]> = {}) {
  const values: Record<string, string | string[]> = {
    anchorDate: "2026-10-01",
    fixedIntervalAnchorDate: tokyoDateFromNow(0),
    fixedIntervalCount: "2",
    fixedIntervalUnit: "week",
    initialDateMode: "previous_completion",
    intervalMax: "2",
    intervalMin: "1",
    intervalUnit: "week",
    managedItemId: "",
    plannedDate: "2026-10-10",
    recurrenceBasis: "once",
    scheduleDayOfMonth: "25",
    scheduleDayOfWeek: "1",
    // Issue #102: 毎週の曜日はチェックボックスなので複数送られる。
    scheduleDaysOfWeek: ["1"],
    scheduleKind: "weekly",
    scheduleMonth: "8",
    scheduleWeekLast: "0",
    scheduleWeekOfMonth: "2",
    title: "家族会議",
    ...overrides,
  };
  const formData = new FormData();
  Object.entries(values).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => { formData.append(key, entry); });
      return;
    }
    formData.set(key, value);
  });
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
  createCalendarTaskMock.mockResolvedValue("task-rule-id");
  createIntervalTaskMock.mockResolvedValue("task-rule-id");
  createMaintenanceTaskMock.mockResolvedValue("task-rule-id");
  createOneTimeTaskMock.mockResolvedValue("task-rule-id");
});

// Issue #101: 定例日基準Todoの登録入力の解釈は方式が5つになり、他の繰り返し方の
// テスト(todo-registration-actions.test.ts)と同じファイルに収まらなくなった。
describe("定例日基準Todoの登録操作", () => {
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

  it("管理対象なしの週次定例Todoを登録する", async () => {
    await createTodo(
      INITIAL_STATE,
      todoForm({ recurrenceBasis: "calendar", scheduleDaysOfWeek: ["3"] }),
    );

    expect(createCalendarTaskMock).toHaveBeenCalledWith("db", "session", {
      managedItemId: null,
      recurrenceBasis: "calendar",
      scheduleDayOfMonth: null,
      scheduleDaysOfWeek: [3],
      scheduleKind: "weekly",
      scheduleMonth: null,
      scheduleMonthEnd: false,
      scheduleWeekOfMonth: null,
      title: "家族会議",
    }, expect.any(Date));
  });

  // Issue #102 / YDR-040: 毎週は複数の曜日を選べる。重複は畳み、昇順に並べる。
  it("毎週で選んだ複数の曜日を昇順・重複なしで渡す", async () => {
    await createTodo(
      INITIAL_STATE,
      todoForm({
        recurrenceBasis: "calendar",
        scheduleDaysOfWeek: ["4", "1", "4"],
      }),
    );

    expect(createCalendarTaskMock).toHaveBeenCalledWith(
      "db",
      "session",
      expect.objectContaining({ scheduleDaysOfWeek: [1, 4], scheduleKind: "weekly" }),
      expect.any(Date),
    );
  });

  it("毎週で曜日を1つも選ばないと登録しない", async () => {
    const result = await createTodo(
      INITIAL_STATE,
      todoForm({ recurrenceBasis: "calendar", scheduleDaysOfWeek: [] }),
    );

    expect(getD1ContextMock).not.toHaveBeenCalled();
    expect(result).toEqual({ message: "曜日を1つ以上選んでください。", status: "error" });
  });

  it.each([
    ["monthly_day", { scheduleDayOfMonth: 31 }],
    [
      "monthly_nth_weekday",
      {
        scheduleDaysOfWeek: [2],
        scheduleWeekLast: false,
        scheduleWeekOfMonth: 5,
        scheduleWeeksOfMonth: [5],
      },
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
      scheduleDaysOfWeek: [],
      scheduleKind,
      scheduleMonth: null,
      scheduleMonthEnd: false,
      scheduleWeekOfMonth: null,
      title: "家族会議",
      ...expected,
    }, expect.any(Date));
  });
});

describe("毎月の複数第N曜日と最終曜日", () => {
  // Issue #100 / YDR-040: 曜日は1つ、第1〜第5と最終は複数選択として渡す。
  it("毎月の複数の第N曜日と最終曜日を昇順・重複なしで渡す", async () => {
    await createTodo(
      INITIAL_STATE,
      todoForm({
        recurrenceBasis: "calendar",
        scheduleDayOfWeek: "2",
        scheduleKind: "monthly_nth_weekday",
        scheduleWeekLast: "1",
        scheduleWeekOfMonth: ["4", "2", "4", "5"],
      }),
    );

    expect(createCalendarTaskMock).toHaveBeenCalledWith(
      "db",
      "session",
      expect.objectContaining({
        scheduleDaysOfWeek: [2],
        scheduleKind: "monthly_nth_weekday",
        scheduleWeekLast: true,
        scheduleWeeksOfMonth: [2, 4, 5],
      }),
      expect.any(Date),
    );
  });

  it("毎月の曜日方式で出現位置を1つも選ばないと登録しない", async () => {
    const result = await createTodo(
      INITIAL_STATE,
      todoForm({
        recurrenceBasis: "calendar",
        scheduleKind: "monthly_nth_weekday",
        scheduleWeekLast: "0",
        scheduleWeekOfMonth: [],
      }),
    );

    expect(getD1ContextMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "第1〜第5または最終を1つ以上選んでください。",
      status: "error",
    });
  });
});

// Issue #101 / YDR-040の3: 毎年も月・曜日・出現位置で指定できる。
describe("毎年の第N曜日と最終曜日", () => {
  it("月と曜日と出現位置を昇順・重複なしで渡す", async () => {
    await createTodo(
      INITIAL_STATE,
      todoForm({
        recurrenceBasis: "calendar",
        scheduleDayOfWeek: "4",
        scheduleKind: "yearly_nth_weekday",
        scheduleMonth: "11",
        scheduleWeekLast: "1",
        scheduleWeekOfMonth: ["3", "1", "3"],
      }),
    );

    expect(createCalendarTaskMock).toHaveBeenCalledWith(
      "db",
      "session",
      expect.objectContaining({
        scheduleDaysOfWeek: [4],
        scheduleKind: "yearly_nth_weekday",
        scheduleMonth: 11,
        scheduleWeekLast: true,
        scheduleWeeksOfMonth: [1, 3],
      }),
      expect.any(Date),
    );
  });

  it("毎年の曜日方式で出現位置を1つも選ばないと登録しない", async () => {
    const result = await createTodo(
      INITIAL_STATE,
      todoForm({
        recurrenceBasis: "calendar",
        scheduleKind: "yearly_nth_weekday",
        scheduleMonth: "11",
        scheduleWeekLast: "0",
        scheduleWeekOfMonth: [],
      }),
    );

    expect(getD1ContextMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "第1〜第5または最終を1つ以上選んでください。",
      status: "error",
    });
  });

  it("範囲外の月では登録しない", async () => {
    const result = await createTodo(
      INITIAL_STATE,
      todoForm({
        recurrenceBasis: "calendar",
        scheduleDayOfWeek: "4",
        scheduleKind: "yearly_nth_weekday",
        scheduleMonth: "13",
        scheduleWeekOfMonth: ["3"],
      }),
    );

    expect(getD1ContextMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "定例日の指定を正しく入力してください。",
      status: "error",
    });
  });
});

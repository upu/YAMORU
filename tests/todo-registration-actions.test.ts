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
const INVALID_CALENDAR_CASES: Record<string, string>[] = [
  { scheduleDayOfWeek: "0", scheduleKind: "weekly" },
  { scheduleDayOfMonth: "32", scheduleKind: "monthly_day" },
  { scheduleKind: "monthly_nth_weekday", scheduleWeekOfMonth: "6" },
  { scheduleDayOfMonth: "30", scheduleKind: "yearly", scheduleMonth: "2" },
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

function todoForm(overrides: Record<string, string> = {}) {
  const values = {
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

beforeEach(() => {
  vi.clearAllMocks();
  getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
  createCalendarTaskMock.mockResolvedValue("task-rule-id");
  createIntervalTaskMock.mockResolvedValue("task-rule-id");
  createMaintenanceTaskMock.mockResolvedValue("task-rule-id");
  createOneTimeTaskMock.mockResolvedValue("task-rule-id");
});

describe("専用ページのTodo登録操作", () => {

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
      recommendedStartValue: 1,
      recommendedUntilOffset: 14,
      recommendedUntilValue: 2,
      recommendedUnit: "week",
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
      scheduleMonthEnd: false,
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
      scheduleMonthEnd: false,
      scheduleWeekOfMonth: null,
      title: "家族会議",
      ...expected,
    });
  });

  // Issue #227 / YDR-032
  it("毎月末は日付31日として保存し、固定日と区別するフラグを立てる", async () => {
    await createTodo(
      INITIAL_STATE,
      todoForm({
        recurrenceBasis: "calendar",
        scheduleDayOfMonth: "15",
        scheduleKind: "monthly_day",
        scheduleMonthEnd: "1",
      }),
    );

    expect(createCalendarTaskMock).toHaveBeenCalledWith("db", "session", {
      managedItemId: null,
      recurrenceBasis: "calendar",
      scheduleDayOfMonth: 31,
      scheduleDayOfWeek: null,
      scheduleKind: "monthly_day",
      scheduleMonth: null,
      scheduleMonthEnd: true,
      scheduleWeekOfMonth: null,
      title: "家族会議",
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

describe("完了日基準Todoの月・年単位", () => {
  it("月単位は前回実施日の月末を補正し、入力値と単位を失わず渡す", async () => {
    await createTodo(INITIAL_STATE, todoForm({
      anchorDate: "2027-01-31",
      intervalMax: "2",
      intervalMin: "1",
      intervalUnit: "month",
      recurrenceBasis: "completion",
    }));

    expect(createMaintenanceTaskMock).toHaveBeenCalledWith("db", "session", expect.objectContaining({
      firstDueAt: "2027-03-30T15:00:00.000Z",
      firstScheduledFor: "2027-02-27T15:00:00.000Z",
      recommendedStartValue: 1,
      recommendedUntilValue: 2,
      recommendedUnit: "month",
    }));
  });

  it("年単位はうるう日の初回と上限を同じ起点から計算する", async () => {
    await createTodo(INITIAL_STATE, todoForm({
      anchorDate: "2028-02-29",
      intervalMax: "4",
      intervalMin: "1",
      intervalUnit: "year",
      recurrenceBasis: "completion",
    }));

    expect(createMaintenanceTaskMock).toHaveBeenCalledWith("db", "session", expect.objectContaining({
      firstDueAt: "2032-02-28T15:00:00.000Z",
      firstScheduledFor: "2029-02-27T15:00:00.000Z",
      recommendedStartValue: 1,
      recommendedUntilValue: 4,
      recommendedUnit: "year",
    }));
  });

  it("次回開始日を指定する月単位では開始日から幅だけを暦加算する", async () => {
    await createTodo(INITIAL_STATE, todoForm({
      anchorDate: "2027-02-28",
      initialDateMode: "next_window_start",
      intervalMax: "2",
      intervalMin: "1",
      intervalUnit: "month",
      recurrenceBasis: "completion",
    }));

    expect(createMaintenanceTaskMock).toHaveBeenCalledWith("db", "session", expect.objectContaining({
      firstDueAt: "2027-03-27T15:00:00.000Z",
      firstScheduledFor: "2027-02-27T15:00:00.000Z",
    }));
  });

  it.each([
    ["月の上限超過", { intervalMax: "121", intervalUnit: "month" }],
    ["年の上限超過", { intervalMax: "11", intervalUnit: "year" }],
    ["未定義の単位", { intervalUnit: "quarter" }],
    ["開始が上限より大きい", { intervalMax: "1", intervalMin: "2", intervalUnit: "month" }],
  ])("%sなら登録しない", async (_label, overrides) => {
    const result = await createTodo(
      INITIAL_STATE,
      todoForm({ recurrenceBasis: "completion", ...overrides }),
    );

    expect(getD1ContextMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "次回の目安は0以上の整数で、短い方を長い方以下にしてください。",
      status: "error",
    });
  });
});

// Issue #99 / YDR-037: 固定間隔(N日ごと・N週ごと)の登録と入力制約。
describe("専用ページの固定間隔Todo登録操作", () => {
  // Issue #99 / YDR-037
  it("隔週(2週ごと)の固定間隔Todoを、単位と回数を分けたまま登録する", async () => {
    await createTodo(
      INITIAL_STATE,
      todoForm({ recurrenceBasis: "interval", title: "ゴミ出し" }),
    );

    expect(createIntervalTaskMock).toHaveBeenCalledWith("db", "session", {
      intervalAnchorOn: tokyoDateFromNow(0),
      intervalCount: 2,
      intervalUnit: "week",
      managedItemId: null,
      recurrenceBasis: "interval",
      title: "ゴミ出し",
    });
  });

  it("N日ごとの固定間隔Todoを登録する", async () => {
    await createTodo(
      INITIAL_STATE,
      todoForm({
        fixedIntervalCount: "10",
        fixedIntervalUnit: "day",
        recurrenceBasis: "interval",
      }),
    );

    expect(createIntervalTaskMock).toHaveBeenCalledWith(
      "db",
      "session",
      expect.objectContaining({ intervalCount: 10, intervalUnit: "day" }),
    );
  });

  it.each([
    ["0", "week"],
    ["-1", "week"],
    ["1.5", "week"],
    ["521", "week"],
    ["3651", "day"],
  ])("間隔が%s(%s)ならRPCへ送らない", async (count, unit) => {
    const result = await createTodo(
      INITIAL_STATE,
      todoForm({
        fixedIntervalCount: count,
        fixedIntervalUnit: unit,
        recurrenceBasis: "interval",
      }),
    );

    expect(getD1ContextMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "繰り返す間隔と起点日を正しく入力してください。",
      status: "error",
    });
  });

  it.each([
    ["未定義の単位", { fixedIntervalUnit: "month" }],
    ["存在しない起点日", { fixedIntervalAnchorDate: "2026-02-30" }],
    ["空の起点日", { fixedIntervalAnchorDate: "" }],
    ["10年より先の起点日", { fixedIntervalAnchorDate: tokyoDateFromNow(3651) }],
    ["10年より前の起点日", { fixedIntervalAnchorDate: tokyoDateFromNow(-3651) }],
  ])("%sはRPCへ送らない", async (_label, overrides) => {
    const result = await createTodo(
      INITIAL_STATE,
      todoForm({ recurrenceBasis: "interval", ...overrides }),
    );

    expect(getD1ContextMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "繰り返す間隔と起点日を正しく入力してください。",
      status: "error",
    });
  });

  it("上限ちょうどの間隔と起点日は登録できる", async () => {
    await createTodo(
      INITIAL_STATE,
      todoForm({
        fixedIntervalAnchorDate: tokyoDateFromNow(3650),
        fixedIntervalCount: "520",
        fixedIntervalUnit: "week",
        recurrenceBasis: "interval",
      }),
    );

    expect(createIntervalTaskMock).toHaveBeenCalledWith(
      "db",
      "session",
      expect.objectContaining({ intervalCount: 520 }),
    );
  });
});

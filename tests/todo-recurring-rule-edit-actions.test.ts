import { beforeEach, describe, expect, it, vi } from "vitest";

// Issue #367 / #369: 繰り返しTodoのルール編集(updateRecurringRule)のうち、
// 定例日の候補指定と完了日基準・固定間隔の入力解釈。1回だけのTodoの編集と
// 現在回の編集はtests/todo-edit-actions.test.tsにある。登録側も同じように
// 定例日だけを別ファイル(todo-registration-calendar-actions.test.ts)へ
// 分けている。

const {
  getD1ContextMock,
  redirectMock,
  revalidatePathMock,
  updateRecurringOccurrenceMock,
  updateRecurringTaskRuleMock,
} = vi.hoisted(() => ({
  getD1ContextMock: vi.fn(),
  redirectMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  updateRecurringOccurrenceMock: vi.fn(),
  updateRecurringTaskRuleMock: vi.fn(),
}));

vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/todos", () => ({
  updateOneTimeTodo: vi.fn(),
  updateRecurringOccurrence: updateRecurringOccurrenceMock,
  updateRecurringTaskRule: updateRecurringTaskRuleMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import { updateRecurringRule } from "../src/app/todos/[id]/actions";
import { INITIAL_MAINTENANCE_TODO_STATE } from "../src/features/todos/state";

describe("繰り返しTodoの編集(定例日の候補指定)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    updateRecurringOccurrenceMock.mockResolvedValue({ managedItemId: null });
    updateRecurringTaskRuleMock.mockResolvedValue({ previousManagedItemId: null });
  });

  // Issue #102 / YDR-040: 毎週の曜日は複数選べる。未選択のままでは保存しない。
  it("毎週の複数曜日を昇順・重複なしでD1へ渡す", async () => {
    const formData = new FormData();
    for (const [key, value] of Object.entries({
      id: "occurrence-1",
      managedItemId: "",
      recurrenceBasis: "calendar",
      scheduleKind: "weekly",
      title: "毎週火曜と金曜の家族会議",
    })) formData.set(key, value);
    for (const weekday of ["5", "2", "5"]) formData.append("scheduleDaysOfWeek", weekday);

    await updateRecurringRule(INITIAL_MAINTENANCE_TODO_STATE, formData);

    expect(updateRecurringTaskRuleMock).toHaveBeenCalledWith(
      "db",
      "session",
      "occurrence-1",
      expect.objectContaining({ scheduleDaysOfWeek: [2, 5], scheduleKind: "weekly" }),
    );
  });

  it("毎週で曜日が1つも選ばれていないと保存しない", async () => {
    const formData = new FormData();
    for (const [key, value] of Object.entries({
      id: "occurrence-1",
      managedItemId: "",
      recurrenceBasis: "calendar",
      scheduleKind: "weekly",
      title: "毎週の家族会議",
    })) formData.set(key, value);

    const result = await updateRecurringRule(INITIAL_MAINTENANCE_TODO_STATE, formData);

    expect(updateRecurringTaskRuleMock).not.toHaveBeenCalled();
    expect(result.status).toBe("error");
  });

  it("毎年で実在しない月日は保存しない", async () => {
    const formData = new FormData();
    for (const [key, value] of Object.entries({
      id: "occurrence-1",
      managedItemId: "",
      recurrenceBasis: "calendar",
      scheduleDayOfMonth: "31",
      scheduleKind: "yearly",
      scheduleMonth: "4",
      title: "年度末の確認",
    })) formData.set(key, value);

    const result = await updateRecurringRule(INITIAL_MAINTENANCE_TODO_STATE, formData);

    expect(updateRecurringTaskRuleMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "定例パターンを正しく入力してください。",
      status: "error",
    });
  });

  // Issue #100 / YDR-040: 月次の曜日方式は曜日を1つ、第N・最終を複数選ぶ。
  it("毎月の複数の第N曜日と最終曜日をD1へ渡す", async () => {
    const formData = new FormData();
    for (const [key, value] of Object.entries({
      id: "occurrence-1",
      managedItemId: "",
      recurrenceBasis: "calendar",
      scheduleDayOfWeek: "5",
      scheduleKind: "monthly_nth_weekday",
      scheduleWeekLast: "1",
      title: "資源ごみを出す",
    })) formData.set(key, value);
    for (const week of ["4", "2", "4", "5"]) {
      formData.append("scheduleWeekOfMonth", week);
    }

    await updateRecurringRule(INITIAL_MAINTENANCE_TODO_STATE, formData);

    expect(updateRecurringTaskRuleMock).toHaveBeenCalledWith(
      "db",
      "session",
      "occurrence-1",
      expect.objectContaining({
        scheduleDaysOfWeek: [5],
        scheduleKind: "monthly_nth_weekday",
        scheduleWeekLast: true,
        scheduleWeeksOfMonth: [2, 4, 5],
      }),
    );
  });

  it("毎月の曜日方式で出現位置を1つも選ばないと保存しない", async () => {
    const formData = new FormData();
    for (const [key, value] of Object.entries({
      id: "occurrence-1",
      managedItemId: "",
      recurrenceBasis: "calendar",
      scheduleDayOfWeek: "5",
      scheduleKind: "monthly_nth_weekday",
      title: "資源ごみを出す",
    })) formData.set(key, value);

    const result = await updateRecurringRule(INITIAL_MAINTENANCE_TODO_STATE, formData);

    expect(updateRecurringTaskRuleMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "第1〜第5または最終を1つ以上選んでください。",
      status: "error",
    });
  });

  // Issue #101 / YDR-040の3: 年次の曜日方式は月・曜日・出現位置を渡す。
  it("毎年の第N曜日と最終曜日をD1へ渡す", async () => {
    const formData = new FormData();
    for (const [key, value] of Object.entries({
      id: "occurrence-1",
      managedItemId: "",
      recurrenceBasis: "calendar",
      scheduleDayOfWeek: "4",
      scheduleKind: "yearly_nth_weekday",
      scheduleMonth: "11",
      scheduleWeekLast: "1",
      title: "年末の大掃除",
    })) formData.set(key, value);
    for (const week of ["3", "1", "3"]) {
      formData.append("scheduleWeekOfMonth", week);
    }

    await updateRecurringRule(INITIAL_MAINTENANCE_TODO_STATE, formData);

    expect(updateRecurringTaskRuleMock).toHaveBeenCalledWith(
      "db",
      "session",
      "occurrence-1",
      expect.objectContaining({
        scheduleDaysOfWeek: [4],
        scheduleKind: "yearly_nth_weekday",
        scheduleMonth: 11,
        scheduleWeekLast: true,
        scheduleWeeksOfMonth: [1, 3],
      }),
    );
  });

  it("毎年の曜日方式で月が範囲外なら保存しない", async () => {
    const formData = new FormData();
    for (const [key, value] of Object.entries({
      id: "occurrence-1",
      managedItemId: "",
      recurrenceBasis: "calendar",
      scheduleDayOfWeek: "4",
      scheduleKind: "yearly_nth_weekday",
      scheduleMonth: "0",
      scheduleWeekOfMonth: "3",
      title: "年末の大掃除",
    })) formData.set(key, value);

    const result = await updateRecurringRule(INITIAL_MAINTENANCE_TODO_STATE, formData);

    expect(updateRecurringTaskRuleMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "定例パターンを正しく入力してください。",
      status: "error",
    });
  });
});

describe("繰り返しTodoの編集(完了日基準・固定間隔)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
    updateRecurringOccurrenceMock.mockResolvedValue({ managedItemId: null });
    updateRecurringTaskRuleMock.mockResolvedValue({ previousManagedItemId: null });
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

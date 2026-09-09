import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createCalendarTaskMock,
  createIntervalTaskMock,
  createMaintenanceTaskMock,
  createOneTimeTaskMock,
  getD1ContextMock,
  redirectMock,
  revalidatePathMock,
  updateRecurringTaskRuleMock,
} = vi.hoisted(() => ({
  createCalendarTaskMock: vi.fn(),
  createIntervalTaskMock: vi.fn(),
  createMaintenanceTaskMock: vi.fn(),
  createOneTimeTaskMock: vi.fn(),
  getD1ContextMock: vi.fn(),
  redirectMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  updateRecurringTaskRuleMock: vi.fn(),
}));

vi.mock("../src/lib/d1/context", () => ({ getD1Context: getD1ContextMock }));
vi.mock("../src/lib/d1/todos", () => ({
  createCalendarTask: createCalendarTaskMock,
  createIntervalTask: createIntervalTaskMock,
  createMaintenanceTask: createMaintenanceTaskMock,
  createOneTimeTask: createOneTimeTaskMock,
  updateRecurringTaskRule: updateRecurringTaskRuleMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import { updateRecurringRule } from "../src/app/todos/[id]/actions";
import { createTodo } from "../src/app/todos/new/actions";
import { INITIAL_MAINTENANCE_TODO_STATE } from "../src/app/managed-items/[id]/state";

// Issue #367: 登録(createTodo)と編集(updateRecurringRule)は、繰り返し条件の
// 解釈と制約値を共通の処理から受け取る。ここでは同じ入力に対して同じ受理・
// 拒否になること、維持すると決めた文言の違いだけが残ることを確かめる。

const INITIAL_REGISTRATION_STATE = { message: "", status: "idle" } as const;

function tokyoToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Tokyo",
    year: "numeric",
  }).format(new Date());
}

function formOf(values: Record<string, string | string[]>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const entry of value) formData.append(key, entry);
      continue;
    }
    formData.set(key, value);
  }
  return formData;
}

async function register(values: Record<string, string | string[]>) {
  return createTodo(INITIAL_REGISTRATION_STATE, formOf({ title: "資源ごみを出す", ...values }));
}

async function editRule(values: Record<string, string | string[]>) {
  return updateRecurringRule(
    INITIAL_MAINTENANCE_TODO_STATE,
    formOf({ id: "occurrence-1", managedItemId: "", title: "資源ごみを出す", ...values }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getD1ContextMock.mockResolvedValue({ db: "db", session: "session" });
  createCalendarTaskMock.mockResolvedValue("task-rule-id");
  createIntervalTaskMock.mockResolvedValue("task-rule-id");
  createMaintenanceTaskMock.mockResolvedValue("task-rule-id");
  updateRecurringTaskRuleMock.mockResolvedValue({ previousManagedItemId: null });
});

describe("定例日条件の共通化", () => {
  it("同じ入力を登録と編集が同じ候補指定へ正規化する", async () => {
    const schedule = {
      recurrenceBasis: "calendar",
      scheduleDayOfWeek: "5",
      scheduleKind: "monthly_nth_weekday",
      scheduleWeekLast: "1",
      scheduleWeekOfMonth: ["4", "2", "4"],
    };
    const normalized = {
      scheduleDayOfMonth: null,
      scheduleDaysOfWeek: [5],
      scheduleKind: "monthly_nth_weekday",
      scheduleMonth: null,
      scheduleMonthEnd: false,
      scheduleWeekLast: true,
      scheduleWeekOfMonth: 2,
      scheduleWeeksOfMonth: [2, 4],
    };

    await register(schedule);
    await editRule(schedule);

    expect(createCalendarTaskMock).toHaveBeenCalledWith(
      "db",
      "session",
      expect.objectContaining(normalized),
      expect.any(Date),
    );
    expect(updateRecurringTaskRuleMock).toHaveBeenCalledWith(
      "db",
      "session",
      "occurrence-1",
      expect.objectContaining(normalized),
    );
  });

  // 受理・拒否は共通だが、曜日未選択の文言は登録と編集で異なる。統一は別の
  // 仕様変更として扱うため、この差はそのまま維持する(#367)。
  it("曜日未選択はどちらも保存せず、文言だけが異なる", async () => {
    const schedule = {
      recurrenceBasis: "calendar",
      scheduleDaysOfWeek: [],
      scheduleKind: "weekly",
    };

    const registered = await register(schedule);
    const edited = await editRule(schedule);

    expect(createCalendarTaskMock).not.toHaveBeenCalled();
    expect(updateRecurringTaskRuleMock).not.toHaveBeenCalled();
    expect(registered).toEqual({ message: "曜日を1つ以上選んでください。", status: "error" });
    expect(edited).toEqual({
      message: "定例パターンを正しく入力してください。",
      status: "error",
    });
  });

  it("第N週も最終週も選ばれていないときは、どちらも同じ文言で拒否する", async () => {
    const schedule = {
      recurrenceBasis: "calendar",
      scheduleDayOfWeek: "5",
      scheduleKind: "monthly_nth_weekday",
      scheduleWeekLast: "0",
      scheduleWeekOfMonth: [],
    };
    const expected = {
      message: "第1〜第5または最終を1つ以上選んでください。",
      status: "error",
    };

    expect(await register(schedule)).toEqual(expected);
    expect(await editRule(schedule)).toEqual(expected);
    expect(createCalendarTaskMock).not.toHaveBeenCalled();
    expect(updateRecurringTaskRuleMock).not.toHaveBeenCalled();
  });
});

describe("制約値の共通化", () => {
  const weekly = {
    recurrenceBasis: "calendar",
    scheduleDaysOfWeek: ["1"],
    scheduleKind: "weekly",
  };

  it("Todo名の上限を超える入力は、どちらも同じ文言で拒否する", async () => {
    const expected = {
      message: "Todo名は1文字以上100文字以内で入力してください。",
      status: "error",
    };

    expect(await register({ ...weekly, title: "あ".repeat(101) })).toEqual(expected);
    expect(await editRule({ ...weekly, title: "あ".repeat(101) })).toEqual(expected);
  });

  it("Todo名が上限ちょうどならどちらも保存する", async () => {
    await register({ ...weekly, title: "あ".repeat(100) });
    await editRule({ ...weekly, title: "あ".repeat(100) });

    expect(createCalendarTaskMock).toHaveBeenCalled();
    expect(updateRecurringTaskRuleMock).toHaveBeenCalled();
  });

  // Issue #99 / YDR-037の7: 固定間隔の上限はDBのCHECK制約と同じ値。
  it.each([
    ["上限ちょうどは保存する", "520", true],
    ["上限超過は保存しない", "521", false],
  ])("固定間隔の週数の%s", async (_name, fixedIntervalCount, saved) => {
    const interval = {
      fixedIntervalAnchorDate: tokyoToday(),
      fixedIntervalCount,
      fixedIntervalUnit: "week",
      recurrenceBasis: "interval",
    };

    await register(interval);
    await editRule(interval);

    expect(createIntervalTaskMock.mock.calls.length > 0).toBe(saved);
    expect(updateRecurringTaskRuleMock.mock.calls.length > 0).toBe(saved);
  });

  // YDR-038: 完了日基準の月・年は暦で数えるため、上限も単位ごとに持つ。
  it.each([
    ["上限ちょうどは保存する", "120", true],
    ["上限超過は保存しない", "121", false],
  ])("完了日基準の月数の%s", async (_name, intervalMax, saved) => {
    const completion = {
      anchorDate: "2026-10-01",
      initialDateMode: "previous_completion",
      intervalMax,
      intervalMin: "1",
      intervalUnit: "month",
      recurrenceBasis: "completion",
    };

    await register(completion);
    await editRule(completion);

    expect(createMaintenanceTaskMock.mock.calls.length > 0).toBe(saved);
    expect(updateRecurringTaskRuleMock.mock.calls.length > 0).toBe(saved);
  });
});

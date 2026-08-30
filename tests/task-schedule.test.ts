import { describe, expect, it } from "vitest";

import {
  type CalendarScheduleRule,
  describeCalendarSchedule,
  describeCompletionRecurrence,
  MAINTENANCE_DISPLAY_COPY,
  maintenanceReminderThresholdDays,
  toRecurrenceBasis,
} from "../src/app/task-schedule";

it("定例日基準を既知の繰り返し方式として扱う", () => {
  expect(toRecurrenceBasis("calendar")).toBe("calendar");
});

// Issue #227 / YDR-032
describe("定例日基準Todoの繰り返しパターン表示", () => {
  const EMPTY: CalendarScheduleRule = {
    scheduleDayOfMonth: null,
    scheduleDayOfWeek: null,
    scheduleKind: null,
    scheduleMonth: null,
    scheduleMonthEnd: false,
    scheduleWeekOfMonth: null,
  };

  it("毎週の曜日を表示する", () => {
    expect(describeCalendarSchedule({ ...EMPTY, scheduleDayOfWeek: 1, scheduleKind: "weekly" }))
      .toBe("毎週月曜日");
  });

  it("毎月の固定日を表示する", () => {
    expect(describeCalendarSchedule({ ...EMPTY, scheduleDayOfMonth: 25, scheduleKind: "monthly_day" }))
      .toBe("毎月25日");
  });

  it("固定日31日と月末を区別して表示する", () => {
    expect(describeCalendarSchedule({ ...EMPTY, scheduleDayOfMonth: 31, scheduleKind: "monthly_day" }))
      .toBe("毎月31日");
    expect(describeCalendarSchedule({
      ...EMPTY,
      scheduleDayOfMonth: 31,
      scheduleKind: "monthly_day",
      scheduleMonthEnd: true,
    })).toBe("毎月末");
  });

  it("毎月の第N曜日を表示する", () => {
    expect(describeCalendarSchedule({
      ...EMPTY,
      scheduleDayOfWeek: 2,
      scheduleKind: "monthly_nth_weekday",
      scheduleWeekOfMonth: 5,
    })).toBe("毎月第5火曜日");
  });

  it("毎年の月日を表示する", () => {
    expect(describeCalendarSchedule({
      ...EMPTY,
      scheduleDayOfMonth: 29,
      scheduleKind: "yearly",
      scheduleMonth: 2,
    })).toBe("毎年2月29日");
  });

  it("繰り返しなし・完了日基準では表示しない", () => {
    expect(describeCalendarSchedule(EMPTY)).toBeNull();
  });
});

// Issue #244(設計メモ案1)
describe("完了日基準Todoの推奨期間表示(describeCompletionRecurrence)", () => {
  it("開始・上限がどちらも7で割り切れる場合は週間で表示する", () => {
    expect(describeCompletionRecurrence(28, 56)).toBe("完了から4〜8週間後");
  });

  it("7で割り切れない場合は日数で表示する", () => {
    expect(describeCompletionRecurrence(10, 20)).toBe("完了から10〜20日後");
  });

  it("開始だけ7で割り切れても上限が割り切れない場合は日数で表示する", () => {
    expect(describeCompletionRecurrence(28, 30)).toBe("完了から28〜30日後");
  });

  it("開始と上限が同じ場合は値を重複させない", () => {
    expect(describeCompletionRecurrence(28, 28)).toBe("完了から4週間後");
    expect(describeCompletionRecurrence(10, 10)).toBe("完了から10日後");
  });
});

describe("メンテナンスTodoの表示文言(MAINTENANCE_DISPLAY_COPY)", () => {
  it("推奨期間前・期間内・上限超過は文言とトーンがそれぞれ異なる", () => {
    const entries = Object.values(MAINTENANCE_DISPLAY_COPY);

    expect(new Set(entries.map((entry) => entry.badge)).size).toBe(3);
    expect(new Set(entries.map((entry) => entry.tone)).size).toBe(3);
  });
});

describe("そろそろ表示のしきい値日数(maintenanceReminderThresholdDays, Issue #52)", () => {
  it("80%ちょうどで割り切れる場合はその日数をそのまま返す", () => {
    expect(maintenanceReminderThresholdDays(10)).toBe(8);
    expect(maintenanceReminderThresholdDays(5)).toBe(4);
  });

  it("80%ちょうどにならない場合は切り上げて、ちょうど80%を含める", () => {
    expect(maintenanceReminderThresholdDays(28)).toBe(23); // 22.4→23
    expect(maintenanceReminderThresholdDays(1)).toBe(1); // 0.8→1
  });

  it("開始日と上限日が同日(0日)以下はゼロ除算せず0を返す", () => {
    expect(maintenanceReminderThresholdDays(0)).toBe(0);
    expect(maintenanceReminderThresholdDays(-1)).toBe(0);
  });
});

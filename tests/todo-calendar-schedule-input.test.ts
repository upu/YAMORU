import { describe, expect, it } from "vitest";

import {
  calendarScheduleWithNulls,
  parseCalendarScheduleInput,
} from "../src/app/todos/calendar-schedule-input";

// Issue #367: 定例日条件の解釈は登録・編集で共通の純粋関数へまとめた。境界値は
// 呼び出し側(actionsのテスト)ではなく、ここでまとめて確かめる。

function scheduleForm(values: Record<string, string | string[]>): FormData {
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

describe("毎週の曜日", () => {
  it("重複を畳んで昇順に並べる", () => {
    expect(
      parseCalendarScheduleInput(
        scheduleForm({ scheduleDaysOfWeek: ["7", "2", "7"], scheduleKind: "weekly" }),
      ),
    ).toEqual({
      scheduleDaysOfWeek: [2, 7],
      scheduleKind: "weekly",
      scheduleMonthEnd: false,
    });
  });

  it("1つも選ばれていないときは曜日未選択として区別する", () => {
    expect(
      parseCalendarScheduleInput(
        scheduleForm({ scheduleDaysOfWeek: [], scheduleKind: "weekly" }),
      ),
    ).toBe("empty_weekdays");
  });

  it.each([["0"], ["8"], ["月"], [""]])(
    "範囲外・数字でない曜日(%s)が1つでもあれば拒否する",
    (weekday) => {
      expect(
        parseCalendarScheduleInput(
          scheduleForm({ scheduleDaysOfWeek: ["1", weekday], scheduleKind: "weekly" }),
        ),
      ).toBe("invalid_schedule");
    },
  );
});

describe("毎月の日付と月末", () => {
  it.each([["1", 1], ["31", 31]])("上限内の日付(%s)を受け取る", (input, expected) => {
    expect(
      parseCalendarScheduleInput(
        scheduleForm({ scheduleDayOfMonth: input, scheduleKind: "monthly_day" }),
      ),
    ).toEqual({
      scheduleDayOfMonth: expected,
      scheduleKind: "monthly_day",
      scheduleMonthEnd: false,
    });
  });

  it.each([["0"], ["32"]])("範囲外の日付(%s)は拒否する", (dayOfMonth) => {
    expect(
      parseCalendarScheduleInput(
        scheduleForm({ scheduleDayOfMonth: dayOfMonth, scheduleKind: "monthly_day" }),
      ),
    ).toBe("invalid_schedule");
  });

  // Issue #227 / YDR-032: 月末は日付入力を見ず、常に31日として保存する。
  it("月末は入力された日付によらず31日と月末フラグで表す", () => {
    expect(
      parseCalendarScheduleInput(
        scheduleForm({
          scheduleDayOfMonth: "5",
          scheduleKind: "monthly_day",
          scheduleMonthEnd: "1",
        }),
      ),
    ).toEqual({
      scheduleDayOfMonth: 31,
      scheduleKind: "monthly_day",
      scheduleMonthEnd: true,
    });
  });
});

describe("第N週と最終週", () => {
  it("出現位置の重複を畳み、先頭を旧列の値として残す", () => {
    expect(
      parseCalendarScheduleInput(
        scheduleForm({
          scheduleDayOfWeek: "5",
          scheduleKind: "monthly_nth_weekday",
          scheduleWeekLast: "1",
          scheduleWeekOfMonth: ["4", "2", "4"],
        }),
      ),
    ).toEqual({
      scheduleDaysOfWeek: [5],
      scheduleKind: "monthly_nth_weekday",
      scheduleMonth: undefined,
      scheduleMonthEnd: false,
      scheduleWeekLast: true,
      scheduleWeekOfMonth: 2,
      scheduleWeeksOfMonth: [2, 4],
    });
  });

  // YDR-040の4: 最終週は第5週の近似ではないため、単独でも成立する。
  it("最終週だけの指定を受け取る", () => {
    expect(
      parseCalendarScheduleInput(
        scheduleForm({
          scheduleDayOfWeek: "5",
          scheduleKind: "monthly_nth_weekday",
          scheduleWeekLast: "1",
          scheduleWeekOfMonth: [],
        }),
      ),
    ).toMatchObject({ scheduleWeekLast: true, scheduleWeekOfMonth: null, scheduleWeeksOfMonth: [] });
  });

  it("第Nも最終も選ばれていないときは出現位置未選択として区別する", () => {
    expect(
      parseCalendarScheduleInput(
        scheduleForm({
          scheduleDayOfWeek: "5",
          scheduleKind: "monthly_nth_weekday",
          scheduleWeekLast: "0",
          scheduleWeekOfMonth: [],
        }),
      ),
    ).toBe("empty_week_positions");
  });

  it.each([
    ["範囲外の第N週", { scheduleWeekOfMonth: ["6"] }],
    ["0の第N週", { scheduleWeekOfMonth: ["0"] }],
    ["0でも1でもない最終週", { scheduleWeekLast: "2", scheduleWeekOfMonth: ["1"] }],
    ["範囲外の曜日", { scheduleDayOfWeek: "8", scheduleWeekOfMonth: ["1"] }],
  ])("%sは拒否する", (_name, overrides) => {
    expect(
      parseCalendarScheduleInput(
        scheduleForm({
          scheduleDayOfWeek: "5",
          scheduleKind: "monthly_nth_weekday",
          scheduleWeekLast: "0",
          ...overrides,
        }),
      ),
    ).toBe("invalid_schedule");
  });
});

describe("毎年の月日と第N曜日", () => {
  // うるう年でだけ成立する2月29日は受け取り、実在しない月日は拒否する(YDR-021)。
  it.each([
    ["2月29日", { scheduleDayOfMonth: "29", scheduleMonth: "2" }, { day: 29, month: 2 }],
    ["12月31日", { scheduleDayOfMonth: "31", scheduleMonth: "12" }, { day: 31, month: 12 }],
  ])("%sを受け取る", (_name, overrides, expected) => {
    expect(
      parseCalendarScheduleInput(scheduleForm({ scheduleKind: "yearly", ...overrides })),
    ).toEqual({
      scheduleDayOfMonth: expected.day,
      scheduleKind: "yearly",
      scheduleMonth: expected.month,
      scheduleMonthEnd: false,
    });
  });

  it.each([
    ["2月30日", { scheduleDayOfMonth: "30", scheduleMonth: "2" }],
    ["4月31日", { scheduleDayOfMonth: "31", scheduleMonth: "4" }],
    ["13月", { scheduleDayOfMonth: "1", scheduleMonth: "13" }],
    ["0月", { scheduleDayOfMonth: "1", scheduleMonth: "0" }],
  ])("%sは拒否する", (_name, overrides) => {
    expect(
      parseCalendarScheduleInput(scheduleForm({ scheduleKind: "yearly", ...overrides })),
    ).toBe("invalid_schedule");
  });

  it("毎年の曜日方式は月も条件に含める", () => {
    expect(
      parseCalendarScheduleInput(
        scheduleForm({
          scheduleDayOfWeek: "4",
          scheduleKind: "yearly_nth_weekday",
          scheduleMonth: "11",
          scheduleWeekLast: "0",
          scheduleWeekOfMonth: ["3"],
        }),
      ),
    ).toMatchObject({ scheduleMonth: 11, scheduleWeeksOfMonth: [3] });
  });

  it("毎年の曜日方式で月が範囲外なら出現位置を見ずに拒否する", () => {
    expect(
      parseCalendarScheduleInput(
        scheduleForm({
          scheduleDayOfWeek: "4",
          scheduleKind: "yearly_nth_weekday",
          scheduleMonth: "13",
          scheduleWeekOfMonth: ["3"],
        }),
      ),
    ).toBe("invalid_schedule");
  });
});

describe("方式の指定と保存形への変換", () => {
  it.each([["monthly"], [""], ["daily"]])("知らない方式(%s)は拒否する", (kind) => {
    expect(parseCalendarScheduleInput(scheduleForm({ scheduleKind: kind })))
      .toBe("invalid_schedule");
  });

  it("方式が送られてこないときも拒否する", () => {
    expect(parseCalendarScheduleInput(new FormData())).toBe("invalid_schedule");
  });

  it("使わない項目をNULL・空配列で埋めた形へそろえる", () => {
    expect(
      calendarScheduleWithNulls({
        scheduleDaysOfWeek: [2, 7],
        scheduleKind: "weekly",
        scheduleMonthEnd: false,
      }),
    ).toEqual({
      scheduleDayOfMonth: null,
      scheduleDaysOfWeek: [2, 7],
      scheduleKind: "weekly",
      scheduleMonth: null,
      scheduleMonthEnd: false,
      scheduleWeekOfMonth: null,
    });
  });
});

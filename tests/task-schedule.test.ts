import { describe, expect, it } from "vitest";

import { type StoredCalendarSpec } from "../src/lib/d1/calendar";
import {
  describeCalendarSchedule,
  describeIntervalRecurrence,
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
  const EMPTY_SPEC = {
    dayOfMonth: 0,
    dayOfWeek: 0,
    month: 0,
    monthEnd: false,
    weekLast: false,
    weekOfMonth: 0,
  };

  function specs(kind: string, ...values: Partial<StoredCalendarSpec>[]): StoredCalendarSpec[] {
    return values.map((value) => ({ ...EMPTY_SPEC, kind, ...value }));
  }

  it("毎週の曜日を表示する", () => {
    expect(describeCalendarSchedule(specs("weekly", { dayOfWeek: 1 }))).toBe("毎週月曜日");
  });

  // Issue #102 / YDR-040の10
  it("毎週の複数曜日を並べて表示する", () => {
    expect(describeCalendarSchedule(specs("weekly", { dayOfWeek: 1 }, { dayOfWeek: 4 })))
      .toBe("毎週月曜日・木曜日");
  });

  it("毎月の固定日を表示する", () => {
    expect(describeCalendarSchedule(specs("monthly_day", { dayOfMonth: 25 })))
      .toBe("毎月25日");
  });

  it("固定日31日と月末を区別して表示する", () => {
    expect(describeCalendarSchedule(specs("monthly_day", { dayOfMonth: 31 })))
      .toBe("毎月31日");
    expect(describeCalendarSchedule(
      specs("monthly_day", { dayOfMonth: 31, monthEnd: true }),
    )).toBe("毎月末");
  });

  it("毎月の第N曜日を表示する", () => {
    expect(describeCalendarSchedule(
      specs("monthly_nth_weekday", { dayOfWeek: 2, weekOfMonth: 5 }),
    )).toBe("毎月第5火曜日");
  });

  it("毎年の月日を表示する", () => {
    expect(describeCalendarSchedule(specs("yearly", { dayOfMonth: 29, month: 2 })))
      .toBe("毎年2月29日");
  });

  it("繰り返しなし・完了日基準では表示しない", () => {
    expect(describeCalendarSchedule([])).toBeNull();
  });

  it("種類の違う候補指定が混ざっている場合は表示しない", () => {
    expect(describeCalendarSchedule([
      { ...EMPTY_SPEC, dayOfWeek: 1, kind: "weekly" },
      { ...EMPTY_SPEC, dayOfMonth: 5, kind: "monthly_day" },
    ])).toBeNull();
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

  it("保存した月・年単位を日数へ言い換えず表示する", () => {
    expect(describeCompletionRecurrence(0, 0, 1, 2, "month"))
      .toBe("完了から1〜2か月後");
    expect(describeCompletionRecurrence(0, 0, 1, 1, "year"))
      .toBe("完了から1年後");
  });
});

describe("メンテナンスTodoの表示文言(MAINTENANCE_DISPLAY_COPY)", () => {
  it("4状態を開始前・推奨期間・そろそろ・推奨期間超過として区別する(Issue #281)", () => {
    expect(MAINTENANCE_DISPLAY_COPY).toEqual({
      "before-window": {
        badge: "予定",
        message: "次回の交換予定です",
        tone: "upcoming",
      },
      "in-window": {
        badge: "推奨期間",
        message: "交換の推奨期間です",
        tone: "upcoming",
      },
      "past-window": {
        badge: "推奨期間超過",
        message: "交換推奨期間を過ぎています",
        tone: "caution",
      },
      "reminder-window": {
        badge: "そろそろ",
        message: "そろそろ交換時期です",
        tone: "reminder",
      },
    });
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

// Issue #99 / YDR-037: 固定間隔は起点日と間隔で表示し、2週ごとは「隔週」と
// 分かるようにする。
describe("固定間隔の繰り返し表示(describeIntervalRecurrence)", () => {
  it("N日ごとを起点日つきで表す", () => {
    expect(describeIntervalRecurrence({
      intervalAnchorOn: "2026-08-01",
      intervalCount: 10,
      intervalUnit: "day",
    })).toBe("8月1日から10日ごと");
  });

  it("2週ごとは隔週と分かるように併記する", () => {
    expect(describeIntervalRecurrence({
      intervalAnchorOn: "2026-08-03",
      intervalCount: 2,
      intervalUnit: "week",
    })).toBe("8月3日から2週間ごと(隔週)");
  });

  it("2週以外の週指定には隔週を付けない", () => {
    expect(describeIntervalRecurrence({
      intervalAnchorOn: "2026-08-03",
      intervalCount: 3,
      intervalUnit: "week",
    })).toBe("8月3日から3週間ごと");
  });

  it("固定間隔ではない行や不正な値はnullを返す", () => {
    const valid = {
      intervalAnchorOn: "2026-08-01",
      intervalCount: 10,
      intervalUnit: "day",
    };
    expect(describeIntervalRecurrence({
      intervalAnchorOn: null,
      intervalCount: null,
      intervalUnit: null,
    })).toBeNull();
    expect(describeIntervalRecurrence({ ...valid, intervalCount: 0 })).toBeNull();
    expect(describeIntervalRecurrence({ ...valid, intervalCount: 1.5 })).toBeNull();
    expect(describeIntervalRecurrence({ ...valid, intervalUnit: "month" })).toBeNull();
    expect(describeIntervalRecurrence({ ...valid, intervalAnchorOn: "2026-8-1" })).toBeNull();
    // 形式が正しくても実在しない暦日は表示しない(2月30日と誤表示しない)。
    expect(describeIntervalRecurrence({ ...valid, intervalAnchorOn: "2026-02-30" })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import {
  calendarScheduledForOnOrAfter,
  nextCalendarOccurrence,
  tokyoDateFromIso,
} from "../lib/d1/calendar";

const EMPTY = {
  scheduleDayOfMonth: null,
  scheduleDayOfWeek: null,
  scheduleMonth: null,
  scheduleWeekOfMonth: null,
};

describe("D1の暦基準Todo計算", () => {
  it("ISO日時を実行環境の表示形式に依存せず東京日付へ変換する", () => {
    expect(tokyoDateFromIso("2026-08-20T14:59:59.000Z")).toBe("2026-08-20");
    expect(tokyoDateFromIso("2026-08-20T15:00:00.000Z")).toBe("2026-08-21");
  });

  it("月末31日は短い月の最終日へ丸める", () => {
    expect(calendarScheduledForOnOrAfter(
      { ...EMPTY, scheduleDayOfMonth: 31, scheduleKind: "monthly_day" },
      "2027-02-01",
    )).toBe("2027-02-27T15:00:00.000Z");
  });

  it("存在しない第5曜日は次に存在する月まで進める", () => {
    expect(calendarScheduledForOnOrAfter(
      {
        ...EMPTY,
        scheduleDayOfWeek: 1,
        scheduleKind: "monthly_nth_weekday",
        scheduleWeekOfMonth: 5,
      },
      "2026-02-01",
    )).toBe("2026-03-29T15:00:00.000Z");
  });

  it("年次2月29日は非うるう年の月末へ丸める", () => {
    expect(calendarScheduledForOnOrAfter(
      { ...EMPTY, scheduleDayOfMonth: 29, scheduleKind: "yearly", scheduleMonth: 2 },
      "2027-01-01",
    )).toBe("2027-02-27T15:00:00.000Z");
  });

  it("完了日と現在Occurrenceの翌日の遅い方から次回を求める", () => {
    expect(nextCalendarOccurrence(
      { ...EMPTY, scheduleDayOfWeek: 1, scheduleKind: "weekly" },
      "2026-08-16T15:00:00.000Z",
      "2026-08-25T00:00:00.000Z",
    )).toBe("2026-08-30T15:00:00.000Z");
  });
});

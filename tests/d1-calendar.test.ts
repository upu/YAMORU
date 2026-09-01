import { describe, expect, it } from "vitest";

import {
  addTokyoCalendarDate,
  addTokyoCalendarInterval,
  calendarScheduledForOnOrAfter,
  intervalScheduledForOnOrAfter,
  nextCalendarOccurrence,
  nextIntervalOccurrence,
  tokyoDateFromIso,
} from "../src/lib/d1/calendar";

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

// Issue #48 / YDR-038: 完了日基準の月・年は固定日数へ換算せず、起点から
// 対象年月へ一度に移動して存在しない日だけ月末へ補正する。
describe("完了日基準Todoの暦間隔加算", () => {
  it("日・週は従来どおり東京の暦日を加算する", () => {
    expect(addTokyoCalendarDate("2026-12-31", 1, "day")).toBe("2027-01-01");
    expect(addTokyoCalendarDate("2026-12-28", 1, "week")).toBe("2027-01-04");
  });

  it("1月31日の1か月後は2月末、2か月後は3月31日にする", () => {
    expect(addTokyoCalendarDate("2027-01-31", 1, "month")).toBe("2027-02-28");
    expect(addTokyoCalendarDate("2028-01-31", 1, "month")).toBe("2028-02-29");
    expect(addTokyoCalendarDate("2027-01-31", 2, "month")).toBe("2027-03-31");
  });

  it("2月29日の1年後は2月28日、4年後は2月29日にする", () => {
    expect(addTokyoCalendarDate("2028-02-29", 1, "year")).toBe("2029-02-28");
    expect(addTokyoCalendarDate("2028-02-29", 4, "year")).toBe("2032-02-29");
  });

  it("完了日時は東京の暦日に直してから同じ補正規則を使う", () => {
    expect(addTokyoCalendarInterval("2027-01-31T15:00:00.000Z", 1, "month"))
      .toBe("2027-02-28T15:00:00.000Z");
  });

  it("負値・小数・未定義の単位は計算しない", () => {
    expect(() => addTokyoCalendarDate("2027-01-31", -1, "month")).toThrow();
    expect(() => addTokyoCalendarDate("2027-01-31", 1.5, "month")).toThrow();
    expect(() => addTokyoCalendarDate("2027-01-31", 1, "quarter")).toThrow();
  });
});

// Issue #99 / YDR-037: 候補列は起点日 + k * 間隔日数で、完了日に依存しない。
// scheduled_forはその暦日のAsia/Tokyo 00:00(= 前日15:00Z)。
describe("D1の固定間隔Todo計算", () => {
  const everyTenDays = {
    intervalAnchorOn: "2026-08-01",
    intervalCount: 10,
    intervalUnit: "day",
  };
  const biweekly = {
    intervalAnchorOn: "2026-08-03",
    intervalCount: 2,
    intervalUnit: "week",
  };

  it("起点日当日は起点日そのものを初回候補にする", () => {
    expect(intervalScheduledForOnOrAfter(everyTenDays, "2026-08-01"))
      .toBe("2026-07-31T15:00:00.000Z");
  });

  it("起点日が過去でも、指定日以降で最初の候補だけを返す", () => {
    // 8/1, 8/11, 8/21…のうち8/15以降で最初の候補は8/21。飛ばした候補は作らない。
    expect(intervalScheduledForOnOrAfter(everyTenDays, "2026-08-15"))
      .toBe("2026-08-20T15:00:00.000Z");
    expect(intervalScheduledForOnOrAfter(everyTenDays, "2026-08-21"))
      .toBe("2026-08-20T15:00:00.000Z");
  });

  it("N週は7×N日として扱い、起点日と同じ曜日を保つ", () => {
    // 2026-08-03は月曜日。隔週の候補は8/17、8/31…と常に月曜。
    expect(intervalScheduledForOnOrAfter(biweekly, "2026-08-04"))
      .toBe("2026-08-16T15:00:00.000Z");
    expect(intervalScheduledForOnOrAfter(biweekly, "2026-08-18"))
      .toBe("2026-08-30T15:00:00.000Z");
  });

  it("前倒し完了では周期を1回分だけ進める", () => {
    expect(nextIntervalOccurrence(
      everyTenDays,
      "2026-08-10T15:00:00.000Z",
      "2026-08-08T02:00:00.000Z",
    )).toBe("2026-08-20T15:00:00.000Z");
  });

  it("遅れて完了しても、完了日ではなく起点からの周期で次回を決める", () => {
    // 8/11予定を8/16に完了: 固定間隔の次回は8/21(完了日基準の10日後=8/26ではない)。
    expect(nextIntervalOccurrence(
      everyTenDays,
      "2026-08-10T15:00:00.000Z",
      "2026-08-16T02:00:00.000Z",
    )).toBe("2026-08-20T15:00:00.000Z");
  });

  it("大きく遅れた完了では、飛ばした候補を作らず次の将来候補へ進める", () => {
    // 8/11予定を8/25に完了: 8/21は飛ばし、次回は8/31。
    expect(nextIntervalOccurrence(
      everyTenDays,
      "2026-08-10T15:00:00.000Z",
      "2026-08-25T02:00:00.000Z",
    )).toBe("2026-08-30T15:00:00.000Z");
  });

  it("完了日の暦日そのものは次回候補にしない", () => {
    // 8/21当日に完了した場合、8/21は候補にせず8/31へ進める。
    expect(nextIntervalOccurrence(
      everyTenDays,
      "2026-08-10T15:00:00.000Z",
      "2026-08-20T15:00:00.000Z",
    )).toBe("2026-08-30T15:00:00.000Z");
  });

  it("隔週は遅延完了があっても同じ曜日のまま進む", () => {
    expect(nextIntervalOccurrence(
      biweekly,
      "2026-08-16T15:00:00.000Z",
      "2026-08-20T02:00:00.000Z",
    )).toBe("2026-08-30T15:00:00.000Z");
  });

  it("実在しない起点日は繰り上げず、その場で失敗する", () => {
    expect(() => intervalScheduledForOnOrAfter(
      { ...everyTenDays, intervalAnchorOn: "2026-02-30" },
      "2026-03-01",
    )).toThrow("Invalid calendar date");
    expect(() => nextIntervalOccurrence(
      { ...everyTenDays, intervalAnchorOn: "2026-02-30" },
      "2026-08-10T15:00:00.000Z",
      "2026-08-16T02:00:00.000Z",
    )).toThrow("Invalid calendar date");
  });

  it("単位や回数が不正なら計算せずに失敗する", () => {
    expect(() => intervalScheduledForOnOrAfter(
      { ...everyTenDays, intervalUnit: "month" },
      "2026-08-01",
    )).toThrow();
    expect(() => intervalScheduledForOnOrAfter(
      { ...everyTenDays, intervalCount: 0 },
      "2026-08-01",
    )).toThrow();
    expect(() => intervalScheduledForOnOrAfter(
      { ...everyTenDays, intervalCount: null },
      "2026-08-01",
    )).toThrow();
  });
});

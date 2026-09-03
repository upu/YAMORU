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

// Issue #102 / YDR-040: 候補指定では未使用の項目を0で表す。
const EMPTY_SPEC = {
  dayOfMonth: 0,
  dayOfWeek: 0,
  month: 0,
  weekLast: false,
  weekOfMonth: 0,
};

function schedule(
  scheduleKind: string,
  ...specs: Partial<typeof EMPTY_SPEC>[]
) {
  return { scheduleKind, specs: specs.map((spec) => ({ ...EMPTY_SPEC, ...spec })) };
}

describe("D1の暦基準Todo計算", () => {
  it("ISO日時を実行環境の表示形式に依存せず東京日付へ変換する", () => {
    expect(tokyoDateFromIso("2026-08-20T14:59:59.000Z")).toBe("2026-08-20");
    expect(tokyoDateFromIso("2026-08-20T15:00:00.000Z")).toBe("2026-08-21");
  });

  it("月末31日は短い月の最終日へ丸める", () => {
    expect(calendarScheduledForOnOrAfter(
      schedule("monthly_day", { dayOfMonth: 31 }),
      "2027-02-01",
    )).toBe("2027-02-27T15:00:00.000Z");
  });

  it("存在しない第5曜日は次に存在する月まで進める", () => {
    expect(calendarScheduledForOnOrAfter(
      schedule("monthly_nth_weekday", { dayOfWeek: 1, weekOfMonth: 5 }),
      "2026-02-01",
    )).toBe("2026-03-29T15:00:00.000Z");
  });

  // Issue #100 / YDR-040: 最終曜日は第5曜日とは別の指定で、4回しかない月も
  // 必ずその月の最後の該当曜日を候補にする。
  it("最終曜日は4回しかない月もその月の最後の曜日を返す", () => {
    expect(calendarScheduledForOnOrAfter(
      schedule("monthly_nth_weekday", {
        dayOfWeek: 5,
        weekLast: true,
        weekOfMonth: 5,
      }),
      "2026-08-01",
    )).toBe("2026-08-27T15:00:00.000Z");
  });

  it("年次2月29日は非うるう年の月末へ丸める", () => {
    expect(calendarScheduledForOnOrAfter(
      schedule("yearly", { dayOfMonth: 29, month: 2 }),
      "2027-01-01",
    )).toBe("2027-02-27T15:00:00.000Z");
  });

  it("完了日と現在Occurrenceの翌日の遅い方から次回を求める", () => {
    expect(nextCalendarOccurrence(
      schedule("weekly", { dayOfWeek: 1 }),
      "2026-08-16T15:00:00.000Z",
      "2026-08-25T00:00:00.000Z",
    )).toBe("2026-08-30T15:00:00.000Z");
  });
});

// Issue #102 / YDR-040: 複数の候補指定を持つルールは、指定ごとの候補の和集合を
// 昇順に並べ、同一暦日を1件へ畳んだ候補列として扱う。
describe("複数候補を持つ定例日ルールの候補計算", () => {
  // 2026年8月の月曜は3・10・17・24・31日、木曜は6・13・20・27日。
  const mondayAndThursday = schedule("weekly", { dayOfWeek: 1 }, { dayOfWeek: 4 });

  it("指定した暦日以降で最も早い曜日を候補にする", () => {
    expect(calendarScheduledForOnOrAfter(mondayAndThursday, "2026-08-04"))
      .toBe("2026-08-05T15:00:00.000Z");
    expect(calendarScheduledForOnOrAfter(mondayAndThursday, "2026-08-07"))
      .toBe("2026-08-09T15:00:00.000Z");
  });

  it("候補指定の順序は結果を変えない", () => {
    expect(calendarScheduledForOnOrAfter(
      schedule("weekly", { dayOfWeek: 4 }, { dayOfWeek: 1 }),
      "2026-08-04",
    )).toBe("2026-08-05T15:00:00.000Z");
  });

  it("完了すると次の選択曜日へ進む", () => {
    // 8月3日(月)の予定を当日完了すると、次回は同じ週の木曜。
    expect(nextCalendarOccurrence(
      mondayAndThursday,
      "2026-08-02T15:00:00.000Z",
      "2026-08-03T02:00:00.000Z",
    )).toBe("2026-08-05T15:00:00.000Z");
  });

  it("遅延完了では実施日時以前の候補を飛ばす", () => {
    // 8月3日(月)の予定を8月20日(木)に完了すると、次回は8月24日(月)。
    expect(nextCalendarOccurrence(
      mondayAndThursday,
      "2026-08-02T15:00:00.000Z",
      "2026-08-20T02:00:00.000Z",
    )).toBe("2026-08-23T15:00:00.000Z");
  });

  it("前倒し完了でも直前の予定日より後の候補へ進む", () => {
    // 8月6日(木)の予定を8月4日に完了しても、次回は8月10日(月)。
    expect(nextCalendarOccurrence(
      mondayAndThursday,
      "2026-08-05T15:00:00.000Z",
      "2026-08-04T02:00:00.000Z",
    )).toBe("2026-08-09T15:00:00.000Z");
  });

  it("同じ暦日を生む候補指定があっても候補は1件に畳まれる", () => {
    // 「毎週月曜」と「毎月第1月曜」は同じ種類にできないため、同じ曜日を
    // 二重に指定した場合で確かめる。
    expect(calendarScheduledForOnOrAfter(
      schedule("weekly", { dayOfWeek: 1 }, { dayOfWeek: 1 }),
      "2026-08-04",
    )).toBe("2026-08-09T15:00:00.000Z");
  });

  it("第5曜日と最終曜日が同じ日でも次回候補を一度だけ進める", () => {
    const fifthAndLastFriday = schedule(
      "monthly_nth_weekday",
      { dayOfWeek: 5, weekOfMonth: 5 },
      { dayOfWeek: 5, weekLast: true, weekOfMonth: 5 },
    );

    // 2026年7月は金曜が5回あり、第5・最終がどちらも7月31日になる。
    expect(calendarScheduledForOnOrAfter(fifthAndLastFriday, "2026-07-31"))
      .toBe("2026-07-30T15:00:00.000Z");
    // 7月31日を完了した次回は、8月の最終金曜。第5金曜だけなら10月まで飛ぶ。
    expect(nextCalendarOccurrence(
      fifthAndLastFriday,
      "2026-07-30T15:00:00.000Z",
      "2026-07-31T02:00:00.000Z",
    )).toBe("2026-08-27T15:00:00.000Z");
  });

  it("候補指定を持たないルールは候補なしにせずエラーにする", () => {
    expect(() => calendarScheduledForOnOrAfter(schedule("weekly"), "2026-08-04"))
      .toThrow("Calendar schedule has no spec");
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

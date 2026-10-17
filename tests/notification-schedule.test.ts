import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "../src/features/integration/notifications/contract";
import { nextAllowedNotificationTime, nextNotificationTime, localNotificationTime } from "../src/features/integration/notifications/schedule";

const at = (value: string) => new Date(value);
describe("本人の通知時刻", () => {
  it.each([
    { enabled: false, muted: false, active: true, expected: null },
    { enabled: true, muted: true, active: true, expected: null },
    { enabled: true, muted: false, active: false, expected: null },
    { enabled: true, muted: false, active: true, expected: "2026-10-17T00:00:00.000Z" },
  ])("通知の有効性・休止・接続を反映した次回時刻を返す(%j)", ({ enabled, muted, active, expected }) => {
    expect(nextAllowedNotificationTime({ ...DEFAULT_SETTINGS, enabled, muted, connectionId: "a" }, active, at("2026-10-16T23:00:00Z"))).toBe(expected);
  });
  it("初期値は無効・朝9時・夜間休止・再通知なし", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ enabled: false, timeZone: "Asia/Tokyo", digestTime: "09:00", mode: "daily", quietStart: "22:00", quietEnd: "08:00", repeatHighHours: null, repeatNormalHours: null });
  });
  it("正しい時刻・タイムゾーン・24時間以上の再通知間隔だけを受け付ける", () => {
    for (const patch of [{ digestTime: "25:00" }, { timeZone: "not/a-zone" }, { repeatHighHours: 1 }, { quietEnd: "22:00" }, { enabled: "true" }]) {
      expect(() => parseSettings({ ...DEFAULT_SETTINGS, ...patch })).toThrow();
    }
    expect(parseSettings({ ...DEFAULT_SETTINGS, repeatHighHours: 24 })).toMatchObject({ repeatHighHours: 24 });
  });
  it("日次まとめ前に待ち、過ぎても未送信なら取りこぼさない", () => {
    const due = at("2026-10-16T23:00:00Z");
    expect(nextNotificationTime(DEFAULT_SETTINGS, due, due)).toBe("2026-10-17T00:00:00.000Z");
    expect(nextNotificationTime(DEFAULT_SETTINGS, at("2026-10-17T01:00:00Z"), due)).toBe("2026-10-17T01:00:00.000Z");
  });
  it("必達日の候補でも静かな時間を迂回せず、休止明けに戻る", () => {
    const settings = { ...DEFAULT_SETTINGS, mode: "individual" as const };
    const due = at("2026-10-17T14:00:00Z");
    expect(nextNotificationTime(settings, due, due)).toBe("2026-10-17T23:00:00.000Z");
    expect(nextNotificationTime(settings, at("2026-10-17T23:00:00Z"), due)).toBe("2026-10-17T23:00:00.000Z");
  });
  it("まとめ時刻が静かな時間なら休止明けへ動かす", () => {
    const settings = { ...DEFAULT_SETTINGS, digestTime: "23:00" };
    expect(nextNotificationTime(settings, at("2026-10-17T01:00:00Z"), at("2026-10-17T01:00:00Z"))).toBe("2026-10-17T23:00:00.000Z");
  });
  it("DSTで欠ける02:30は03:00へ、重複する01:30は最初の一回へ解決する", () => {
    expect(localNotificationTime("2026-03-08", "02:30", "America/New_York")).toBe("2026-03-08T07:00:00.000Z");
    expect(localNotificationTime("2026-11-01", "01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
    const settings = { ...DEFAULT_SETTINGS, timeZone: "America/New_York", digestTime: "01:30", quietEnabled: false };
    expect(nextNotificationTime(settings, at("2026-11-01T06:00:00Z"), at("2026-11-01T06:00:00Z"))).toBe("2026-11-02T06:30:00.000Z");
  });
});

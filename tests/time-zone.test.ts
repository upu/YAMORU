import { describe, expect, it } from "vitest";

import {
  formatDateInput,
  getMaintenanceDisplayStateFromIso,
} from "../app/time-zone";

// scheduled_for/due_atはUTCタイムスタンプとしてDBから返る。ここでは
// Asia/Tokyoの07/10 09:00 JST(0時ではない)前後の値を使い、UTCの暦日と
// Tokyoの暦日がずれるケースでも正しく判定できることを確認する。
describe("Tokyo基準の推奨期間判定(getMaintenanceDisplayStateFromIso)", () => {
  const window = {
    dueAt: "2026-09-04T15:00:00.000Z", // Tokyo: 2026-09-05T00:00
    scheduledFor: "2026-08-06T15:00:00.000Z", // Tokyo: 2026-08-07T00:00
  };

  it("推奨期間前はbefore-windowになる", () => {
    // UTCでは08/07 00:00だが、Tokyoでは08/07 09:00(推奨期間内)。
    // サーバーがUTCで実行されてもTokyoの暦日で判定されることを確認する。
    expect(
      getMaintenanceDisplayStateFromIso(window, "2026-08-07T00:00:00.000Z"),
    ).toBe("in-window");
    expect(
      getMaintenanceDisplayStateFromIso(window, "2026-08-06T10:00:00.000Z"),
    ).toBe("before-window");
  });

  it("推奨期間の開始日と上限日は期間内として扱う", () => {
    expect(
      getMaintenanceDisplayStateFromIso(window, window.scheduledFor),
    ).toBe("in-window");
    expect(getMaintenanceDisplayStateFromIso(window, window.dueAt)).toBe(
      "in-window",
    );
  });

  it("推奨期間の上限を超えるとpast-windowになる", () => {
    // UTCでは09/04 16:00でdueAt(UTC 09/04 15:00)を過ぎているが、
    // Tokyoの暦日ではまだ09/05でdue_atのTokyo暦日と同じため期間内。
    expect(
      getMaintenanceDisplayStateFromIso(window, "2026-09-04T16:00:00.000Z"),
    ).toBe("in-window");
    expect(
      getMaintenanceDisplayStateFromIso(window, "2026-09-05T15:00:00.000Z"),
    ).toBe("past-window");
  });
});

describe("実施日入力欄の既定値(formatDateInput)", () => {
  it("YYYY-MM-DD形式でローカル日付を返す", () => {
    expect(formatDateInput(new Date(2026, 7, 9))).toBe("2026-08-09");
  });
});

import { describe, expect, it } from "vitest";

import { STRICT_DISPLAY_COPY } from "../src/app/task-schedule";
import {
  formatDateInput,
  getMaintenanceDisplayStateFromIso,
  getStrictDisplayStateFromIso,
  tokyoYearFromIso,
} from "../src/app/time-zone";

// scheduled_for/due_atはUTCタイムスタンプとしてDBから返る。ここでは
// Asia/Tokyoの07/10 09:00 JST(0時ではない)前後の値を使い、UTCの暦日と
// Tokyoの暦日がずれるケースでも正しく判定できることを確認する。
describe("Tokyo基準の推奨期間判定(getMaintenanceDisplayStateFromIso)", () => {
  const window = {
    dueAt: "2026-09-04T15:00:00.000Z", // Tokyo: 2026-09-05T00:00
    scheduledFor: "2026-08-06T15:00:00.000Z", // Tokyo: 2026-08-07T00:00
  };
  // 経過29日のうち80%(切り上げ)は24日、しきい値はTokyo暦日で8/7+24=8/31
  // (Issue #52)。

  it("推奨開始日前と開始日当日を別の状態として扱う(Issue #281)", () => {
    // UTCでは08/07 00:00だが、Tokyoでは08/07 09:00(開始直後)。
    // サーバーがUTCで実行されてもTokyoの暦日で判定されることを確認する。
    expect(
      getMaintenanceDisplayStateFromIso(window, "2026-08-07T00:00:00.000Z"),
    ).toBe("in-window");
    expect(
      getMaintenanceDisplayStateFromIso(window, "2026-08-06T10:00:00.000Z"),
    ).toBe("before-window");
  });

  it("80%ちょうどのTokyo暦日からそろそろと案内する(Issue #52)", () => {
    expect(
      getMaintenanceDisplayStateFromIso(window, "2026-08-30T15:00:00.000Z"), // Tokyo: 8/31T00:00
    ).toBe("reminder-window");
    expect(
      getMaintenanceDisplayStateFromIso(window, "2026-08-30T14:59:00.000Z"), // Tokyo: 8/30T23:59
    ).toBe("in-window");
  });

  it("推奨期間の上限日は期間内として扱う", () => {
    expect(getMaintenanceDisplayStateFromIso(window, window.dueAt)).toBe(
      "reminder-window",
    );
  });

  it("推奨期間の上限を超えるとpast-windowになる", () => {
    // UTCでは09/04 16:00でdueAt(UTC 09/04 15:00)を過ぎているが、
    // Tokyoの暦日ではまだ09/05でdue_atのTokyo暦日と同じため期間内。
    expect(
      getMaintenanceDisplayStateFromIso(window, "2026-09-04T16:00:00.000Z"),
    ).toBe("reminder-window");
    expect(
      getMaintenanceDisplayStateFromIso(window, "2026-09-05T15:00:00.000Z"),
    ).toBe("past-window");
  });
});

// #275: Date版のgetStrictDisplayStateを削除したため、厳密な期限(税金・支払い
// など)の3状態は、本番が実際に使うTokyo基準のISO版で確認する。
describe("Tokyo基準の厳密な期限判定(getStrictDisplayStateFromIso)", () => {
  const dueAt = "2026-08-08T15:00:00.000Z"; // Tokyo: 2026-08-09T00:00

  it("期限を過ぎたら期限切れ表示を維持する", () => {
    const state = getStrictDisplayStateFromIso(dueAt, "2026-08-11T15:00:00.000Z"); // Tokyo: 8/12

    expect(state).toBe("overdue");
    expect(STRICT_DISPLAY_COPY[state]).toEqual({
      badge: "期限切れ",
      tone: "urgent",
    });
  });

  it("期限当日・期限前は期限切れにしない", () => {
    expect(getStrictDisplayStateFromIso(dueAt, "2026-08-08T15:00:00.000Z")).toBe(
      "due-today",
    ); // Tokyo: 8/9T00:00
    expect(getStrictDisplayStateFromIso(dueAt, "2026-07-31T15:00:00.000Z")).toBe(
      "upcoming",
    ); // Tokyo: 8/1
  });

  it("UTCの暦日ではなくTokyoの暦日で判定する", () => {
    // UTCの暦日は8/9で期限当日に見えるが、Tokyoではすでに8/10のため期限切れ。
    expect(getStrictDisplayStateFromIso(dueAt, "2026-08-09T15:00:00.000Z")).toBe(
      "overdue",
    );
  });
});

describe("実施日入力欄の既定値(formatDateInput)", () => {
  it("YYYY-MM-DD形式でローカル日付を返す", () => {
    expect(formatDateInput(new Date(2026, 7, 9))).toBe("2026-08-09");
  });
});

// Issue #287: 開始時期の年欄placeholderが使う「現在年」を、Server Component
// の実行タイムゾーン(UTC)に左右されずAsia/Tokyoの暦日基準で求める。
describe("Tokyo基準の現在年(tokyoYearFromIso)", () => {
  it("Tokyoの暦日での年をそのまま返す", () => {
    expect(tokyoYearFromIso("2026-08-30T12:00:00.000Z")).toBe(2026);
  });

  it("UTCでは前年でもTokyoではすでに年が変わっていれば新しい年を返す", () => {
    // UTC 2025-12-31T15:30は Tokyo 2026-01-01T00:30。
    expect(tokyoYearFromIso("2025-12-31T15:30:00.000Z")).toBe(2026);
  });

  it("UTCがまだ大晦日でTokyoも大晦日のままなら前年を返す", () => {
    // UTC 2025-12-31T10:00は Tokyo 2025-12-31T19:00で、まだ年をまたがない。
    expect(tokyoYearFromIso("2025-12-31T10:00:00.000Z")).toBe(2025);
  });
});

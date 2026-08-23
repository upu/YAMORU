import { describe, expect, it } from "vitest";

import {
  computeMaintenanceWindow,
  describeMaintenanceSchedule,
  getMaintenanceDisplayState,
  getStrictDisplayState,
  MAINTENANCE_DISPLAY_COPY,
  MAINTENANCE_RECOMMENDED_START_DAYS,
  MAINTENANCE_RECOMMENDED_UPPER_DAYS,
  maintenanceReminderThresholdDays,
  parseDateOnly,
  STRICT_DISPLAY_COPY,
  toRecurrenceBasis,
} from "../app/task-schedule";

it("定例日基準を既知の繰り返し方式として扱う", () => {
  expect(toRecurrenceBasis("calendar")).toBe("calendar");
});

describe("推奨期間の計算", () => {
  it("完了から4週間後を推奨開始、8週間後を推奨上限とする", () => {
    expect(MAINTENANCE_RECOMMENDED_START_DAYS).toBe(28);
    expect(MAINTENANCE_RECOMMENDED_UPPER_DAYS).toBe(56);

    const window = computeMaintenanceWindow(parseDateOnly("2026-01-01"));

    expect(window.scheduledFor).toEqual(parseDateOnly("2026-01-29"));
    expect(window.dueAt).toEqual(parseDateOnly("2026-02-26"));
  });

  it("完了日基準では実際の実施日から次の推奨期間を計算する", () => {
    const backdated = computeMaintenanceWindow(parseDateOnly("2026-08-10"));
    const onTime = computeMaintenanceWindow(parseDateOnly("2026-08-12"));

    expect(backdated.scheduledFor).toEqual(parseDateOnly("2026-09-07"));
    expect(onTime.scheduledFor).toEqual(parseDateOnly("2026-09-09"));
  });
});

describe("メンテナンスTodoの表示状態", () => {
  const window = computeMaintenanceWindow(parseDateOnly("2026-07-10")); // 8/7 - 9/4
  // 経過28日のうち80%(切り上げ)は23日、しきい値は8/7+23=8/30(Issue #52)。

  it("推奨期間前は交換を急かさない", () => {
    const state = getMaintenanceDisplayState(window, parseDateOnly("2026-08-01"));

    expect(state).toBe("before-window");
    expect(MAINTENANCE_DISPLAY_COPY[state].tone).not.toBe("urgent");
    expect(MAINTENANCE_DISPLAY_COPY[state].tone).not.toBe("caution");
    expect(describeMaintenanceSchedule(state, window)).toBe(
      "8月7日から交換の目安です",
    );
  });

  it("推奨期間の開始直後は80%未満なので、まだそろそろと案内しない", () => {
    expect(getMaintenanceDisplayState(window, parseDateOnly("2026-08-07"))).toBe(
      "before-window",
    );
    expect(getMaintenanceDisplayState(window, parseDateOnly("2026-08-29"))).toBe(
      "before-window",
    );
  });

  it("80%ちょうどの日から中立的に案内する(Issue #52)", () => {
    const state = getMaintenanceDisplayState(window, parseDateOnly("2026-08-30"));

    expect(state).toBe("in-window");
    expect(MAINTENANCE_DISPLAY_COPY[state].message).toBe("そろそろ交換時期です");
    expect(describeMaintenanceSchedule(state, window)).toBe(
      "9月4日までが交換の目安です",
    );
  });

  it("推奨上限日は期間内として扱う", () => {
    expect(getMaintenanceDisplayState(window, parseDateOnly("2026-09-04"))).toBe(
      "in-window",
    );
  });

  it("推奨期間の上限を超えたら責めずに強い案内をする", () => {
    const state = getMaintenanceDisplayState(window, parseDateOnly("2026-09-05"));

    expect(state).toBe("past-window");
    expect(MAINTENANCE_DISPLAY_COPY[state].message).toBe(
      "交換推奨期間を過ぎています",
    );
    expect(MAINTENANCE_DISPLAY_COPY[state].tone).toBe("caution");
    expect(describeMaintenanceSchedule(state, window)).toBe(
      "9月4日に交換推奨期間の上限を過ぎました",
    );
  });

  it("推奨期間前・期間内・上限超過は文言とトーンがそれぞれ異なる", () => {
    const entries = Object.values(MAINTENANCE_DISPLAY_COPY);

    expect(new Set(entries.map((entry) => entry.badge)).size).toBe(3);
    expect(new Set(entries.map((entry) => entry.tone)).size).toBe(3);
  });

  it("開始日と上限日が同日ならゼロ除算せず当日からそろそろ扱いにする(Issue #52)", () => {
    const sameDayWindow = {
      dueAt: parseDateOnly("2026-08-07"),
      scheduledFor: parseDateOnly("2026-08-07"),
    };

    expect(getMaintenanceDisplayState(sameDayWindow, parseDateOnly("2026-08-06"))).toBe(
      "before-window",
    );
    expect(getMaintenanceDisplayState(sameDayWindow, parseDateOnly("2026-08-07"))).toBe(
      "in-window",
    );
    expect(getMaintenanceDisplayState(sameDayWindow, parseDateOnly("2026-08-08"))).toBe(
      "past-window",
    );
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

describe("厳密な期限のTodo表示(税金・支払いなど)", () => {
  const dueAt = parseDateOnly("2026-08-09");

  it("期限を過ぎたら期限切れ表示を維持する", () => {
    const state = getStrictDisplayState(dueAt, parseDateOnly("2026-08-12"));

    expect(state).toBe("overdue");
    expect(STRICT_DISPLAY_COPY[state]).toEqual({
      badge: "期限切れ",
      tone: "urgent",
    });
  });

  it("期限当日・期限前は期限切れにしない", () => {
    expect(getStrictDisplayState(dueAt, parseDateOnly("2026-08-09"))).toBe(
      "due-today",
    );
    expect(getStrictDisplayState(dueAt, parseDateOnly("2026-08-01"))).toBe(
      "upcoming",
    );
  });
});

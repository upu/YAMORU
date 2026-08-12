import { describe, expect, it } from "vitest";

import {
  computeMaintenanceWindow,
  describeMaintenanceSchedule,
  getMaintenanceDisplayState,
  getStrictDisplayState,
  MAINTENANCE_DISPLAY_COPY,
  MAINTENANCE_RECOMMENDED_START_DAYS,
  MAINTENANCE_RECOMMENDED_UPPER_DAYS,
  parseDateOnly,
  STRICT_DISPLAY_COPY,
} from "../app/task-schedule";

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

  it("推奨期間前は交換を急かさない", () => {
    const state = getMaintenanceDisplayState(window, parseDateOnly("2026-08-01"));

    expect(state).toBe("before-window");
    expect(MAINTENANCE_DISPLAY_COPY[state].tone).not.toBe("urgent");
    expect(MAINTENANCE_DISPLAY_COPY[state].tone).not.toBe("caution");
    expect(describeMaintenanceSchedule(state, window)).toBe(
      "8月7日から交換の目安です",
    );
  });

  it("推奨期間内は中立的に案内する", () => {
    const state = getMaintenanceDisplayState(window, parseDateOnly("2026-08-12"));

    expect(state).toBe("in-window");
    expect(MAINTENANCE_DISPLAY_COPY[state].message).toBe("そろそろ交換時期です");
    expect(describeMaintenanceSchedule(state, window)).toBe(
      "9月4日までが交換の目安です",
    );
  });

  it("推奨期間の開始日と上限日は期間内として扱う", () => {
    expect(getMaintenanceDisplayState(window, parseDateOnly("2026-08-07"))).toBe(
      "in-window",
    );
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

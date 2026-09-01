// Issue #99 / YDR-037: 「起点日からN日ごと・N週ごと」の固定間隔ルールを、
// migrationの再作成・DB制約・完了時の次回計算の三つで確認する。候補列は
// 起点日と間隔だけで決まり、遅れて完了しても完了日に引きずられない。
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyAllMigrations } from "./test-support/migrations";
import { completeTask, createIntervalTask } from "./todos";

const db = env.DB;
const memberA = { email: "a@example.com", userId: "user-a" };
const memberB = { email: "b@example.com", userId: "user-b" };

function requireOccurrenceId(occurrenceId: string | null): string {
  if (occurrenceId === null) throw new Error("Expected a next occurrence to be generated");
  return occurrenceId;
}

async function occurrenceIdForRule(ruleId: string): Promise<string> {
  const row = await db.prepare(
    "SELECT id FROM task_occurrences WHERE task_rule_id = ?1 ORDER BY created_at LIMIT 1",
  ).bind(ruleId).first<{ id: string }>();
  if (row === null) throw new Error("Test occurrence not found");
  return row.id;
}

async function readOccurrence(occurrenceId: string) {
  return db.prepare(
    "SELECT scheduled_for, due_at, status FROM task_occurrences WHERE id = ?1",
  ).bind(occurrenceId).first<{ due_at: string; scheduled_for: string; status: string }>();
}

async function pendingCount(ruleId: string): Promise<number> {
  const row = await db.prepare(
    "SELECT count(*) AS pending FROM task_occurrences WHERE task_rule_id = ?1 AND status = 'pending'",
  ).bind(ruleId).first<{ pending: number }>();
  return row?.pending ?? -1;
}

async function occurrenceCount(ruleId: string): Promise<number> {
  const row = await db.prepare(
    "SELECT count(*) AS total FROM task_occurrences WHERE task_rule_id = ?1",
  ).bind(ruleId).first<{ total: number }>();
  return row?.total ?? -1;
}

async function resetFixtures(): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM task_rule_consumables"),
    db.prepare("DELETE FROM completion_corrections"),
    db.prepare("DELETE FROM activity_logs"),
    db.prepare("DELETE FROM task_occurrences"),
    db.prepare("DELETE FROM task_rules"),
    db.prepare("DELETE FROM managed_items"),
    db.prepare("DELETE FROM household_members"),
    db.prepare("DELETE FROM households"),
    db.prepare("DELETE FROM users"),
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com'), ('user-b', 'b@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A'), ('household-b', 'Household B')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a'), ('household-b', 'user-b')"),
    db.prepare("INSERT INTO managed_items (id, household_id, name, kind) VALUES ('item-a', 'household-a', 'Item A', 'other'), ('item-b', 'household-b', 'Item B', 'other')"),
  ]);
}

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await resetFixtures();
});

describe("固定間隔ルールのDB制約", () => {
  function insertIntervalRule(
    values: { anchorOn: string; count: number | string; id: string; unit: string },
  ) {
    return db.prepare(`INSERT INTO task_rules (
      id, household_id, title, recurrence_basis, deadline_kind,
      interval_unit, interval_count, interval_anchor_on
    ) VALUES (?1, 'household-a', 'Interval', 'interval', 'strict', ?2, ?3, ?4)`)
      .bind(values.id, values.unit, values.count, values.anchorOn)
      .run();
  }

  it.each([
    ["day", 1],
    ["day", 3650],
    ["week", 1],
    ["week", 520],
  ])("%sごと%d回の範囲内なら登録できる", async (unit, count) => {
    await expect(insertIntervalRule({
      anchorOn: "2026-08-01",
      count,
      id: `ok-${unit}-${String(count)}`,
      unit,
    })).resolves.toBeDefined();
  });

  it.each([
    ["0回", { count: 0, unit: "day" }],
    ["負の回数", { count: -1, unit: "day" }],
    ["小数", { count: 1.5, unit: "day" }],
    ["日の上限超過", { count: 3651, unit: "day" }],
    ["週の上限超過", { count: 521, unit: "week" }],
    ["未定義の単位", { count: 1, unit: "month" }],
  ])("%sは登録できない", async (label, values) => {
    await expect(insertIntervalRule({
      anchorOn: "2026-08-01",
      count: values.count,
      id: `ng-${label}`,
      unit: values.unit,
    })).rejects.toThrow();
  });

  it.each(["2026-8-1", "2026-02-30", "20260801", ""])(
    "起点日が暦日として不正(%s)なら登録できない",
    async (anchorOn) => {
      await expect(insertIntervalRule({
        anchorOn,
        count: 1,
        id: `ng-anchor-${anchorOn}`,
        unit: "day",
      })).rejects.toThrow();
    },
  );

  it("固定間隔以外の方式にinterval列を持たせられない", async () => {
    await expect(db.prepare(`INSERT INTO task_rules (
      id, household_id, title, recurrence_basis, deadline_kind,
      schedule_kind, schedule_day_of_week, interval_unit, interval_count, interval_anchor_on
    ) VALUES ('ng-calendar', 'household-a', 'Calendar', 'calendar', 'strict', 'weekly', 1, 'day', 1, '2026-08-01')`)
      .run()).rejects.toThrow();
  });

  it("固定間隔なのにinterval列が欠けていたら登録できない", async () => {
    await expect(db.prepare(`INSERT INTO task_rules (
      id, household_id, title, recurrence_basis, deadline_kind
    ) VALUES ('ng-interval', 'household-a', 'Interval', 'interval', 'strict')`)
      .run()).rejects.toThrow();
  });

  it("固定間隔は定例日指定や推奨期間と併用できない", async () => {
    await expect(db.prepare(`INSERT INTO task_rules (
      id, household_id, title, recurrence_basis, deadline_kind,
      schedule_kind, interval_unit, interval_count, interval_anchor_on
    ) VALUES ('ng-mixed', 'household-a', 'Interval', 'interval', 'strict', 'weekly', 'day', 1, '2026-08-01')`)
      .run()).rejects.toThrow();
    await expect(db.prepare(`INSERT INTO task_rules (
      id, household_id, title, recurrence_basis, deadline_kind,
      recommended_start_offset, recommended_until_offset,
      interval_unit, interval_count, interval_anchor_on
    ) VALUES ('ng-window', 'household-a', 'Interval', 'interval', 'maintenance', 1, 2, 'day', 1, '2026-08-01')`)
      .run()).rejects.toThrow();
  });
});

describe("固定間隔Todoの登録と完了(createIntervalTask / completeTask)", () => {
  async function createEveryTenDays(anchorOn = "2026-08-01", now = "2026-08-01T00:00:00.000Z") {
    return createIntervalTask(db, memberA, {
      intervalAnchorOn: anchorOn,
      intervalCount: 10,
      intervalUnit: "day",
      managedItemId: "item-a",
      title: "水槽の水換え",
    }, new Date(now));
  }

  it("単位と回数を分けて保存し、初回は起点日そのものを予定にする", async () => {
    const ruleId = await createEveryTenDays();

    await expect(db.prepare(
      `SELECT recurrence_basis, deadline_kind, interval_unit, interval_count,
              interval_anchor_on, recommended_start_offset, schedule_kind
         FROM task_rules WHERE id = ?1`,
    ).bind(ruleId).first()).resolves.toEqual({
      deadline_kind: "strict",
      interval_anchor_on: "2026-08-01",
      interval_count: 10,
      interval_unit: "day",
      recommended_start_offset: 0,
      recurrence_basis: "interval",
      schedule_kind: null,
    });
    // Asia/Tokyoの8月1日 00:00 = UTC前日15:00。厳密な期限のため予定日=期限。
    await expect(readOccurrence(await occurrenceIdForRule(ruleId))).resolves.toEqual({
      due_at: "2026-07-31T15:00:00.000Z",
      scheduled_for: "2026-07-31T15:00:00.000Z",
      status: "pending",
    });
  });

  it("起点日が過去でも、登録日以降で最初の候補だけを作る(過去分を補完しない)", async () => {
    const ruleId = await createEveryTenDays("2026-08-01", "2026-08-15T00:00:00.000Z");

    expect(await occurrenceCount(ruleId)).toBe(1);
    await expect(readOccurrence(await occurrenceIdForRule(ruleId))).resolves.toMatchObject({
      scheduled_for: "2026-08-20T15:00:00.000Z",
    });
  });

  it("遅れて完了しても、完了日ではなく起点からの周期で次回を決める", async () => {
    const ruleId = await createEveryTenDays("2026-08-11", "2026-08-11T00:00:00.000Z");
    const occurrenceId = await occurrenceIdForRule(ruleId);

    const nextId = requireOccurrenceId(await completeTask(db, memberA, {
      idempotencyKey: "complete-late",
      occurredAt: "2026-08-16T02:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    }));

    // 完了日基準なら8/26だが、固定間隔の候補列(8/11, 8/21, 8/31…)では8/21。
    await expect(readOccurrence(nextId)).resolves.toEqual({
      due_at: "2026-08-20T15:00:00.000Z",
      scheduled_for: "2026-08-20T15:00:00.000Z",
      status: "pending",
    });
    expect(await pendingCount(ruleId)).toBe(1);
  });

  it("大きく遅れた完了でも、飛ばした候補を作らずpendingを1件に保つ", async () => {
    const ruleId = await createEveryTenDays("2026-08-11", "2026-08-11T00:00:00.000Z");
    const occurrenceId = await occurrenceIdForRule(ruleId);

    const nextId = requireOccurrenceId(await completeTask(db, memberA, {
      idempotencyKey: "complete-very-late",
      occurredAt: "2026-08-25T02:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    }));

    // 8/21は飛ばし、次回は8/31。過去候補はさかのぼって作らない(YDR-016)。
    await expect(readOccurrence(nextId)).resolves.toMatchObject({
      scheduled_for: "2026-08-30T15:00:00.000Z",
    });
    expect(await occurrenceCount(ruleId)).toBe(2);
    expect(await pendingCount(ruleId)).toBe(1);
  });

  it("前倒しで完了しても周期は1回分だけ進む", async () => {
    const ruleId = await createEveryTenDays("2026-08-11", "2026-08-11T00:00:00.000Z");
    const occurrenceId = await occurrenceIdForRule(ruleId);

    const nextId = requireOccurrenceId(await completeTask(db, memberA, {
      idempotencyKey: "complete-early",
      occurredAt: "2026-08-08T02:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    }));

    await expect(readOccurrence(nextId)).resolves.toMatchObject({
      scheduled_for: "2026-08-20T15:00:00.000Z",
    });
  });

  it("隔週(2週ごと)は遅れて完了しても同じ曜日のまま進む", async () => {
    // 2026-08-03は月曜日。候補列は8/3, 8/17, 8/31…。
    const ruleId = await createIntervalTask(db, memberA, {
      intervalAnchorOn: "2026-08-03",
      intervalCount: 2,
      intervalUnit: "week",
      managedItemId: null,
      title: "ゴミ出し",
    }, new Date("2026-08-03T00:00:00.000Z"));
    const occurrenceId = await occurrenceIdForRule(ruleId);

    const nextId = requireOccurrenceId(await completeTask(db, memberA, {
      idempotencyKey: "complete-biweekly",
      occurredAt: "2026-08-20T02:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    }));

    await expect(readOccurrence(nextId)).resolves.toMatchObject({
      scheduled_for: "2026-08-30T15:00:00.000Z",
    });
  });

  it("他家庭の管理対象へは作成できず、他家庭のTaskRuleも作らない", async () => {
    await expect(createIntervalTask(db, memberA, {
      intervalAnchorOn: "2026-08-01",
      intervalCount: 10,
      intervalUnit: "day",
      managedItemId: "item-b",
      title: "Cross-household interval",
    }, new Date("2026-08-01T00:00:00.000Z"))).rejects.toThrow("Managed item not found");

    await expect(db.prepare(
      "SELECT count(*) AS total FROM task_rules WHERE recurrence_basis = 'interval'",
    ).first<{ total: number }>()).resolves.toEqual({ total: 0 });
  });

  it("他家庭のOccurrenceを完了できない", async () => {
    const ruleId = await createIntervalTask(db, memberB, {
      intervalAnchorOn: "2026-08-01",
      intervalCount: 10,
      intervalUnit: "day",
      managedItemId: "item-b",
      title: "B interval",
    }, new Date("2026-08-01T00:00:00.000Z"));
    const occurrenceId = await occurrenceIdForRule(ruleId);

    await expect(completeTask(db, memberA, {
      idempotencyKey: "cross-household",
      occurredAt: "2026-08-05T02:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    })).rejects.toThrow();
    await expect(readOccurrence(occurrenceId)).resolves.toMatchObject({ status: "pending" });
  });
});

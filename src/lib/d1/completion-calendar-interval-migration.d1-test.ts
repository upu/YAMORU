// Issue #48 / YDR-038: 既存の完了日基準行を変更せず、値・単位の追加列を
// expand-firstで足せることと、追加列の越境不変条件を確認する。
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { applyMigrations, applyMigrationsThrough } from "./test-support/migrations";

const db = env.DB;

beforeAll(async () => {
  await applyMigrationsThrough(db, "0016_interval_recurrence");
  await db.batch([
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')"),
    db.prepare(`INSERT INTO task_rules (
      id, household_id, title, recurrence_basis, deadline_kind,
      recommended_start_offset, recommended_until_offset
    ) VALUES ('legacy-completion', 'household-a', 'Legacy', 'completion', 'maintenance', 28, 56)`),
  ]);
  await applyMigrations(db, ["0017_completion_calendar_intervals"]);
});

describe("完了日基準の暦間隔migration", () => {
  it("既存の日数とNULLの追加列を保持する", async () => {
    await expect(db.prepare(`SELECT recommended_start_offset, recommended_until_offset,
      recommended_start_value, recommended_until_value, recommended_unit
      FROM task_rules WHERE id = 'legacy-completion'`).first()).resolves.toEqual({
      recommended_start_offset: 28,
      recommended_start_value: null,
      recommended_unit: null,
      recommended_until_offset: 56,
      recommended_until_value: null,
    });
  });

  it.each([
    ["day", 0, 3650],
    ["week", 1, 520],
    ["month", 1, 120],
    ["year", 1, 10],
  ])("%s単位の境界値を保存できる", async (unit, start, until) => {
    await expect(db.prepare(`INSERT INTO task_rules (
      id, household_id, title, recurrence_basis, deadline_kind,
      recommended_start_offset, recommended_until_offset,
      recommended_start_value, recommended_until_value, recommended_unit
    ) VALUES (?1, 'household-a', 'Calendar interval', 'completion', 'maintenance', 0, 0, ?2, ?3, ?4)`)
      .bind(`valid-${unit}`, start, until, unit).run()).resolves.toBeDefined();
  });

  it.each([
    ["未定義単位", 1, 2, "quarter"],
    ["開始が負値", -1, 2, "month"],
    ["開始が上限より後", 3, 2, "month"],
    ["月の上限超過", 1, 121, "month"],
    ["年の上限超過", 1, 11, "year"],
  ])("%sは保存できない", async (label, start, until, unit) => {
    await expect(db.prepare(`INSERT INTO task_rules (
      id, household_id, title, recurrence_basis, deadline_kind,
      recommended_start_offset, recommended_until_offset,
      recommended_start_value, recommended_until_value, recommended_unit
    ) VALUES (?1, 'household-a', 'Invalid', 'completion', 'maintenance', 0, 0, ?2, ?3, ?4)`)
      .bind(`invalid-${label}`, start, until, unit).run()).rejects.toThrow();
  });

  it("追加列の一部だけを持つ行と完了日基準以外の利用を拒否する", async () => {
    await expect(db.prepare(`INSERT INTO task_rules (
      id, household_id, title, recurrence_basis, deadline_kind,
      recommended_start_value
    ) VALUES ('partial', 'household-a', 'Partial', 'completion', 'maintenance', 1)`)
      .run()).rejects.toThrow();
    await expect(db.prepare(`INSERT INTO task_rules (
      id, household_id, title, recurrence_basis, deadline_kind,
      recommended_start_value, recommended_until_value, recommended_unit
    ) VALUES ('once-with-unit', 'household-a', 'Once', 'once', 'strict', 1, 2, 'month')`)
      .run()).rejects.toThrow();
  });
});

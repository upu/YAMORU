import { env } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { applyMigrations, applyMigrationsThrough } from "./test-support/migrations";
import { resetHouseholdFixtures } from "./test-support/households";
import { connect, registerTestClient } from "./test-support/oauth";
const db = env.DB;
beforeAll(async () => {
  await applyMigrationsThrough(db, "0038_integration_edit_history_keys");
  await resetHouseholdFixtures(db);
  await registerTestClient(db);
  await connect(db, { householdId: "household-a", userId: "user-a" });
  await db.prepare("UPDATE households SET created_at='2026-01-02T03:04:05Z' WHERE id='household-a'").run();
  await applyMigrations(db, ["0039_integration_mcp_limits"]);
});
it("0039は既存ID・時刻・接続を保ち、旧WorkerのSQLも引き続き使える", async () => {
  expect(await db.prepare("SELECT name,created_at FROM households WHERE id='household-a'").first()).toEqual({ name: "Household A", created_at: "2026-01-02T03:04:05Z" });
  expect(await db.prepare("SELECT count(*) AS count FROM oauth_connections WHERE user_id='user-a'").first()).toEqual({ count: 1 });
  await db.prepare("UPDATE managed_items SET name='old Worker write' WHERE id='item-a' AND household_id='household-a'").run();
  expect(await db.prepare("SELECT name FROM managed_items WHERE id='item-a'").first()).toEqual({ name: "old Worker write" });
  expect(await db.prepare("PRAGMA foreign_key_check").all()).toMatchObject({ results: [] });
});
it("運用状態の孤児・未知bucket・3番目のslotを制約で拒否する", async () => {
  await expect(db.prepare("INSERT INTO integration_mcp_rate_windows VALUES('absent','read',0,1)").run()).rejects.toThrow();
  await expect(db.prepare("INSERT INTO integration_mcp_rate_windows VALUES('user-a','unknown',0,1)").run()).rejects.toThrow();
  const row = await db.prepare("SELECT id FROM oauth_connections LIMIT 1").first<{ id: string }>();
  if (!row) throw new Error("fixture connection missing");
  await expect(db.prepare("INSERT INTO integration_mcp_commit_leases VALUES(?,2,'invalid',1)").bind(row.id).run()).rejects.toThrow();
});

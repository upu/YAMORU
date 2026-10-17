import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { applyMigrationsThrough, applyMigrationsAfter } from "./test-support/migrations";
import { resetHouseholdFixtures, createHouseholdAMaintenanceTask } from "./test-support/households";
import { createAttentionReader } from "../../features/integration/attention/service";
import { refreshAttention } from "./attention";
import { readHouseholdVersion } from "./conversation-read";

it("既存行を保ち、旧SQL・複合FK・cascade・batchのrollbackを検証する", async () => {
  const db = env.DB;
  await applyMigrationsThrough(db, "0032_conversation_reads");
  await resetHouseholdFixtures(db);
  const { occurrenceId } = await createHouseholdAMaintenanceTask(db);
  const old = await db.prepare("SELECT * FROM task_occurrences WHERE id=?").bind(occurrenceId).first();
  await applyMigrationsAfter(db, "0032_conversation_reads");
  expect(await db.prepare("SELECT * FROM task_occurrences WHERE id=?").bind(occurrenceId).first()).toEqual(old);
  const api = createAttentionReader({ db, authorize: async () => ({ userId: "user-a", householdId: "household-a", clientId: "test", connectionId: "a", scopes: ["household.read"] }), cursorSecret: "attention-test-secret-at-least-32-bytes", now: () => new Date("2026-10-17T00:00:00Z") });
  const first = await api.attentionGet({});
  const candidate = first.candidates[0];
  await expect(db.prepare("UPDATE attention_candidates SET household_id='household-b'").run()).rejects.toThrow();
  await expect(db.batch([
    db.prepare("UPDATE task_occurrences SET status='skipped' WHERE id=?").bind(occurrenceId),
    db.prepare("INSERT INTO attention_guards(id,valid) VALUES('fail',0)"),
  ])).rejects.toThrow();
  expect((await api.attentionGet({})).candidates[0].candidate_id).toBe(candidate.candidate_id);
  const stale = await readHouseholdVersion(db, "household-a");
  await db.prepare("UPDATE task_occurrences SET must_complete_by='2026-10-17' WHERE id=?").bind(occurrenceId).run();
  await expect(refreshAttention(db, "household-a", stale, new Date("2026-10-18T00:00:00Z"), "")).rejects.toMatchObject({ code: "read_conflict" });
  expect((await db.prepare("SELECT * FROM attention_guards").all()).results).toEqual([]);
  await db.prepare("DELETE FROM task_occurrences WHERE id=?").bind(occurrenceId).run();
  expect((await api.attentionGet({ cursor: first.sync_cursor })).removed_ids).toContain(candidate.candidate_id);
  await db.prepare("DELETE FROM households WHERE id='household-a'").run();
  for (const table of ["attention_candidates", "attention_changes", "attention_refresh"]) {
    expect((await db.prepare(`SELECT * FROM ${table} WHERE household_id='household-a'`).all()).results).toEqual([]);
  }
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
});

import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { applyMigrationsAfter, applyMigrationsThrough } from "./test-support/migrations";
import { resetHouseholdFixtures } from "./test-support/households";

it("在庫履歴の追加移行で旧行・日時・旧SQLを保持し、不明な観測日や実施者を作らない", async () => {
  const db = env.DB;
  await applyMigrationsThrough(db, "0036_notification_candidate_intervals");
  await resetHouseholdFixtures(db);
  await db.prepare("INSERT INTO consumables(id,household_id,name,stock_status,created_at,updated_at) VALUES('stock','household-a','洗剤','low','2026-08-01T00:00:00.000Z','2026-08-02T00:00:00.000Z')").run();
  await db.prepare("INSERT INTO consumable_refills(id,household_id,consumable_id,refilled_on,recorded_at) VALUES('old-refill','household-a','stock','2026-08-01','2026-08-02T01:00:00.000Z')").run();
  // 旧CHECKはdate()がNULLになる不正値を許す。移行で消さず、未知の旧値として保持する。
  await db.prepare("INSERT INTO consumable_refills(id,household_id,consumable_id,refilled_on) VALUES('old-invalid','household-a','stock','2026-99-99')").run();
  const old = await db.prepare("SELECT * FROM consumables WHERE id='stock'").first();
  const refill = await db.prepare("SELECT * FROM consumable_refills WHERE id='old-refill'").first();
  await applyMigrationsAfter(db, "0036_notification_candidate_intervals");
  expect(await db.prepare("SELECT * FROM consumables WHERE id='stock'").first()).toEqual({ ...old, stock_revision: 0 });
  expect(await db.prepare("SELECT * FROM consumable_refills WHERE id='old-refill'").first()).toEqual(refill);
  expect(await db.prepare("SELECT kind,occurred_on,actor_user_id,performer_user_id,source FROM consumable_stock_events WHERE id='snapshot:stock'").first())
    .toEqual({ kind: "state_snapshot", occurred_on: null, actor_user_id: null, performer_user_id: null, source: "unknown" });
  expect(await db.prepare("SELECT kind,occurred_on,recorded_at FROM consumable_stock_events WHERE id='refill:old-refill'").first())
    .toEqual({ kind: "refill", occurred_on: "2026-08-01", recorded_at: "2026-08-02T01:00:00.000Z" });
  expect(await db.prepare("SELECT occurred_on FROM consumable_stock_events WHERE id='refill:old-invalid'").first()).toEqual({ occurred_on: "2026-99-99" });
  const insert = (id: string, household: string, on: string) => db.prepare(`INSERT INTO consumable_stock_events(id,record_id,household_id,consumable_id,kind,action,revision,occurred_on,stock_status,recorded_at,source)
    VALUES(?1,?1,?2,'stock','observation','created',0,?3,'out','2026-10-18T00:00:00.000Z','web')`).bind(id, household, on);
  await expect(insert('cross-household', 'household-b', '2026-10-18').run()).rejects.toThrow();
  await expect(insert('invalid-new-date', 'household-a', '2026-99-99').run()).rejects.toThrow();
  await expect(insert('invalid-new-calendar', 'household-a', '2026-02-30').run()).rejects.toThrow();
  await db.prepare("UPDATE consumables SET stock_status='out' WHERE id='stock'").run();
  expect(await db.prepare("SELECT stock_status,stock_revision FROM consumables WHERE id='stock'").first())
    .toMatchObject({ stock_status: "out", stock_revision: 1 });
  const head = await db.prepare("SELECT e.kind,e.occurred_on,e.source FROM consumable_stock_heads h JOIN consumable_stock_events e ON e.id=h.record_id WHERE h.consumable_id='stock'").first();
  expect(head).toEqual({ kind: "state_snapshot", occurred_on: null, source: "unknown" });
  await db.batch([
    db.prepare("UPDATE consumables SET stock_status='available' WHERE id='stock'"),
    db.prepare("INSERT INTO consumable_refills(id,household_id,consumable_id,refilled_on) VALUES('new-legacy','household-a','stock','2026-09-13')"),
  ]);
  await db.prepare("UPDATE consumable_refills SET refilled_on='2026-09-12' WHERE id='new-legacy'").run();
  expect(await db.prepare("SELECT occurred_on FROM consumable_stock_current WHERE record_id='refill:new-legacy'").first()).toEqual({ occurred_on: "2026-09-12" });
  expect(await db.prepare("SELECT occurred_on FROM consumable_stock_events WHERE id='refill:new-legacy'").first()).toEqual({ occurred_on: "2026-09-13" });
  const count = await db.prepare("SELECT COUNT(*) AS n FROM consumable_stock_events").first();
  await expect(db.batch([
    db.prepare("UPDATE consumables SET stock_status='low' WHERE id='stock'"),
    db.prepare("INSERT INTO attention_guards(id,valid) VALUES('stock-fail',0)"),
  ])).rejects.toThrow();
  expect(await db.prepare("SELECT COUNT(*) AS n FROM consumable_stock_events").first()).toEqual(count);
  expect(await db.prepare("SELECT stock_status FROM consumables WHERE id='stock'").first()).toEqual({ stock_status: "available" });
  await db.prepare("DELETE FROM consumable_refills WHERE id='new-legacy'").run();
  expect(await db.prepare("SELECT COUNT(*) AS n FROM consumable_stock_events WHERE record_id='refill:new-legacy'").first()).toEqual({ n: 0 });
  await db.prepare("DELETE FROM consumables WHERE id='stock'").run();
  for (const table of ["consumable_stock_events", "consumable_stock_current", "consumable_stock_heads", "consumable_stock_write_guards"]) {
    expect((await db.prepare(`SELECT * FROM ${table}`).all()).results).toEqual([]);
  }
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
});

import {
  requireCurrentHouseholdId,
  requireD1Session,
  type D1Session,
} from "./authorization";
import type { ConsumableSummary } from "./consumables";
import { D1NotFoundError } from "./errors";

export async function listPinnedConsumables(
  db: D1Database,
  session: D1Session,
): Promise<ConsumableSummary[]> {
  const user = requireD1Session(session);
  const householdId = await requireCurrentHouseholdId(db, session);
  const { results } = await db.prepare(
    `SELECT c.id, c.name, c.stock_status AS stockStatus
       FROM user_consumable_pins f
       JOIN consumables c
         ON c.id = f.consumable_id AND c.household_id = f.household_id
      WHERE f.user_id = ?1 AND f.household_id = ?2
      ORDER BY f.pinned_at DESC, f.rowid DESC`,
  ).bind(user.userId, householdId).all<ConsumableSummary>();
  return results;
}

export async function setConsumablePinned(
  db: D1Database,
  session: D1Session,
  id: string,
  pinned: boolean,
): Promise<void> {
  const user = requireD1Session(session);
  const householdId = await requireCurrentHouseholdId(db, session);
  const consumable = await db.prepare(
    "SELECT 1 FROM consumables WHERE id = ?1 AND household_id = ?2",
  ).bind(id, householdId).first();
  if (consumable === null) {
    throw new D1NotFoundError("消耗品が見つかりません。");
  }

  if (pinned) {
    await db.prepare(
      `INSERT OR IGNORE INTO user_consumable_pins (
        user_id, household_id, consumable_id
      ) VALUES (?1, ?2, ?3)`,
    ).bind(user.userId, householdId, id).run();
    return;
  }

  await db.prepare(
    `DELETE FROM user_consumable_pins
      WHERE user_id = ?1 AND household_id = ?2 AND consumable_id = ?3`,
  ).bind(user.userId, householdId, id).run();
}

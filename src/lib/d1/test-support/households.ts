// 家庭間分離を確認するD1統合テストが共有する、家庭A・家庭B・部外者の初期状態。
//
// src/lib/d1/authorization.d1-test.tsが1,504行まで肥大化していたため、扱う領域
// ごとにファイルを分けた(#280)。分けた各ファイルが同じ初期状態から始められる
// よう、fixtureをここへ一つ置く。
//
// migrations.tsと同じく"cloudflare:workers"を読み込まずD1Databaseを引数で
// 受け取るため、通常のtsconfig.jsonとeslintの型検査対象に収まる。

import { createMaintenanceTask } from "../todos";

export const householdAMember = { email: "a@example.com", userId: "user-a" };
export const householdBMember = { email: "b@example.com", userId: "user-b" };
export const nonMember = { email: "o@example.com", userId: "user-outsider" };

// 家庭Aに利用者user-aと管理対象item-a、家庭Bにuser-bとitem-bを置き、
// どちらにも属さないuser-outsiderを1人作る。テストごとに呼び出す。
export async function resetHouseholdFixtures(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM task_rule_consumables"),
    db.prepare("DELETE FROM managed_item_consumables"),
    db.prepare("DELETE FROM consumables"),
    db.prepare("DELETE FROM completion_corrections"),
    db.prepare("DELETE FROM invitation_claims"),
    db.prepare("DELETE FROM household_invitations"),
    db.prepare("DELETE FROM activity_logs"),
    db.prepare("DELETE FROM task_occurrences"),
    db.prepare("DELETE FROM task_rules"),
    db.prepare("DELETE FROM external_links"),
    db.prepare("DELETE FROM managed_items"),
    db.prepare("DELETE FROM household_members"),
    db.prepare("DELETE FROM profiles"),
    db.prepare("DELETE FROM households"),
    db.prepare("DELETE FROM users"),
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a','a@example.com'), ('user-b','b@example.com'), ('user-outsider','o@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A'), ('household-b', 'Household B')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a','user-a'), ('household-b','user-b')"),
    db.prepare("INSERT INTO managed_items (id, household_id, name, kind) VALUES ('item-a','household-a','Item A','other'), ('item-b','household-b','Item B','other')"),
  ]);
}

export async function occurrenceForRule(
  db: D1Database,
  ruleId: string,
): Promise<{ id: string; status: string }> {
  const row = await db.prepare(
    "SELECT id, status FROM task_occurrences WHERE task_rule_id = ?1 ORDER BY created_at LIMIT 1",
  ).bind(ruleId).first<{ id: string; status: string }>();
  if (row === null) throw new Error("Test occurrence not found");
  return row;
}

export async function createHouseholdAMaintenanceTask(
  db: D1Database,
): Promise<{ occurrenceId: string; ruleId: string }> {
  const ruleId = await createMaintenanceTask(db, householdAMember, {
    firstDueAt: "2026-08-10T15:00:00.000Z",
    firstScheduledFor: "2026-08-01T15:00:00.000Z",
    managedItemId: "item-a",
    recommendedStartOffset: 1,
    recommendedUntilOffset: 2,
    title: "A maintenance",
  });
  const occurrence = await occurrenceForRule(db, ruleId);
  return { occurrenceId: occurrence.id, ruleId };
}

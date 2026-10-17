import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { applyAllMigrations } from "./test-support/migrations";
import { householdAMember, resetHouseholdFixtures, occurrenceForRule } from "./test-support/households";
import { createOneTimeTask, setTaskOccurrenceAssignee, completeTask, correctCompletionOccurredAt, undoTaskCompletion, setTaskHardDeadline } from "./todos";
import { updateAuthorizedManagedItemName } from "./authorization";
import { updateConsumableStockStatus } from "./consumables";
import { issueHouseholdInvitation, openInvitationClaim, registerInvitedUser } from "./invitations";

const db = env.DB;
beforeAll(async () => {
  await applyAllMigrations(db);
  await db.prepare("CREATE TABLE test_trigger_audit(value INTEGER NOT NULL)").run();
  await db.prepare("INSERT INTO test_trigger_audit VALUES (0)").run();
  for (const table of ["task_occurrences", "activity_logs", "completion_corrections", "task_deadline_changes", "managed_items", "consumables", "household_members"]) {
    for (const event of ["INSERT", "UPDATE"]) {
      await db.prepare(`CREATE TRIGGER test_audit_${table}_${event} AFTER ${event} ON ${table} BEGIN UPDATE test_trigger_audit SET value=value+1; END`).run();
    }
  }
});

it("所属作成にトリガーがあっても招待登録を成功として返す", async () => {
  const issued = await issueHouseholdInvitation(db, householdAMember, "new@example.test");
  const claim = await openInvitationClaim(db, issued.token);
  if (claim === null) throw new Error("Missing test claim");
  const user = await registerInvitedUser(db, { claimSecret: claim.claimSecret, email: "new@example.test", nickname: "Family", passwordHash: "fixture-only", userId: "new-user" });
  expect(user.id).toBe("new-user");
  expect(await db.prepare("SELECT household_id FROM household_members WHERE user_id='new-user'").first()).toEqual({ household_id: "household-a" });
});
beforeEach(() => resetHouseholdFixtures(db));

it("副作用の更新件数が加算されても担当・必達日・完了・訂正・取消が成功する", async () => {
  const ruleId = await createOneTimeTask(db, householdAMember, { title: "掃除", managedItemId: null, scheduledFor: null });
  const { id } = await occurrenceForRule(db, ruleId);
  await setTaskOccurrenceAssignee(db, householdAMember, id, "user-a");
  await setTaskHardDeadline(db, householdAMember, id, "2026-10-17", null);
  await completeTask(db, householdAMember, { occurrenceId: id, idempotencyKey: "done", occurredAt: "2026-01-10T00:00:00.000Z", performedByUserId: null });
  await correctCompletionOccurredAt(db, householdAMember, id, "correct", "2026-01-09T00:00:00.000Z");
  await undoTaskCompletion(db, householdAMember, id, "undo");
  expect(await db.prepare("SELECT status FROM task_occurrences WHERE id=?").bind(id).first()).toEqual({ status: "pending" });
});

it("対象は一行と数え、対象なしは副作用があっても成功にしない", async () => {
  expect(await updateAuthorizedManagedItemName(db, householdAMember, "household-a", "item-a", "Updated")).toBe(1);
  expect(await updateAuthorizedManagedItemName(db, householdAMember, "household-a", "item-b", "Foreign")).toBe(0);
  await db.prepare("INSERT INTO consumables(id,household_id,name) VALUES ('c','household-a','洗剤')").run();
  await updateConsumableStockStatus(db, householdAMember, "c", "low");
  await expect(updateConsumableStockStatus(db, householdAMember, "missing", "out")).rejects.toThrow();
  expect(await db.prepare("SELECT stock_status FROM consumables WHERE id='c'").first()).toEqual({ stock_status: "low" });
});

import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import schemaSql from "../../../d1/migrations/0001_init.sql?raw";
import authSchemaSql from "../../../d1/migrations/0002_auth_invitation_claims.sql?raw";
import migrationAuditSql from "../../../d1/migrations/0003_preserve_supabase_audit_fields.sql?raw";
import completionCorrectionsSql from "../../../d1/migrations/0004_completion_corrections.sql?raw";
import classificationSql from "../../../d1/migrations/0005_managed_item_classification.sql?raw";
import propertyTaxSql from "../../../d1/migrations/0006_property_tax_item_type.sql?raw";
import kindLabelsSql from "../../../d1/migrations/0007_managed_item_kind_labels.sql?raw";
import {
  listAuthorizedManagedItems,
  updateAuthorizedManagedItemName,
} from "./authorization";
import { D1ForbiddenError, D1UnauthorizedError } from "./errors";
import {
  cancelHouseholdInvitation,
  issueHouseholdInvitation,
  listHouseholdInvitations,
} from "./invitations";
import { createFirstHousehold, createProfile, updateProfile } from "./households";
import {
  createManagedItem,
  getManagedItem,
  getManagedItemForEdit,
  listManagedItems,
  updateManagedItem,
} from "./managed-items";
import {
  claimTaskOccurrenceAssignee,
  completeTask,
  correctCompletionOccurredAt,
  correctCompletionPerformer,
  createCalendarTask,
  createMaintenanceTask,
  createOneTimeTask,
  postponeTaskOccurrence,
  setTaskOccurrenceAssignee,
  undoTaskCompletion,
} from "./todos";

const db = env.DB;
const householdAMember = { email: "a@example.com", userId: "user-a" };
const householdBMember = { email: "b@example.com", userId: "user-b" };
const nonMember = { email: "o@example.com", userId: "user-outsider" };

function migrationStatements(): string[] {
  return [
    schemaSql,
    authSchemaSql,
    migrationAuditSql,
    completionCorrectionsSql,
    classificationSql,
    propertyTaxSql,
    kindLabelsSql,
  ].join("\n")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function occurrenceForRule(ruleId: string): Promise<{
  id: string;
  status: string;
}> {
  const row = await db.prepare(
    "SELECT id, status FROM task_occurrences WHERE task_rule_id = ?1 ORDER BY created_at LIMIT 1",
  ).bind(ruleId).first<{ id: string; status: string }>();
  if (row === null) throw new Error("Test occurrence not found");
  return row;
}

async function createHouseholdAMaintenanceTask(): Promise<{
  occurrenceId: string;
  ruleId: string;
}> {
  const ruleId = await createMaintenanceTask(db, householdAMember, {
    firstDueAt: "2026-08-10T15:00:00.000Z",
    firstScheduledFor: "2026-08-01T15:00:00.000Z",
    managedItemId: "item-a",
    recommendedStartOffset: 1,
    recommendedUntilOffset: 2,
    title: "A maintenance",
  });
  const occurrence = await occurrenceForRule(ruleId);
  return { occurrenceId: occurrence.id, ruleId };
}

beforeAll(async () => {
  await db.batch(migrationStatements().map((statement) => db.prepare(statement)));
});

beforeEach(async () => {
  await db.batch([
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
});

describe("D1 formal schema and household authorization", () => {
  it("formal migration creates every application table", async () => {
    const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' ORDER BY name")
      .all<{ name: string }>();
    expect(tables.results.map(({ name }) => name)).toEqual(expect.arrayContaining([
      "activity_logs",
      "external_links",
      "invitation_claims",
      "household_invitations",
      "household_members",
      "households",
      "managed_items",
      "managed_item_classifications",
      "managed_item_kinds",
      "managed_item_type_presets",
      "profiles",
      "task_occurrences",
      "task_rules",
      "users",
    ]));
  });

  it("members can read only their own household", async () => {
    await expect(listAuthorizedManagedItems(db, householdAMember, "household-a"))
      .resolves.toEqual([{ id: "item-a", household_id: "household-a", name: "Item A" }]);
    await expect(listAuthorizedManagedItems(db, householdBMember, "household-b"))
      .resolves.toEqual([{ id: "item-b", household_id: "household-b", name: "Item B" }]);
    await expect(listAuthorizedManagedItems(db, householdAMember, "household-b"))
      .rejects.toBeInstanceOf(D1ForbiddenError);
    await expect(listAuthorizedManagedItems(db, householdBMember, "household-a"))
      .rejects.toBeInstanceOf(D1ForbiddenError);
  });

  it("rejects non-members and unauthenticated callers", async () => {
    await expect(listAuthorizedManagedItems(db, nonMember, "household-a"))
      .rejects.toBeInstanceOf(D1ForbiddenError);
    await expect(listAuthorizedManagedItems(db, null, "household-a"))
      .rejects.toBeInstanceOf(D1UnauthorizedError);
    await expect(createOneTimeTask(db, null, {
      managedItemId: null,
      scheduledFor: "2026-09-01T15:00:00.000Z",
      title: "Unauthorized",
    })).rejects.toBeInstanceOf(D1UnauthorizedError);
  });

  it("does not read or update a B row with an authorized A session and a B ID", async () => {
    await expect(updateAuthorizedManagedItemName(
      db, householdAMember, "household-a", "item-b", "Hacked",
    )).resolves.toBe(0);
    await expect(listManagedItems(db, householdAMember)).resolves.toEqual([
      {
        id: "item-a",
        itemTypeCode: "other",
        itemTypeLabel: "その他",
        kindCode: "other",
        kindLabel: "その他",
        name: "Item A",
      },
    ]);
    await expect(getManagedItem(db, householdAMember, "item-b")).resolves.toBeNull();
    await expect(listAuthorizedManagedItems(db, householdBMember, "household-b"))
      .resolves.toEqual([{ id: "item-b", household_id: "household-b", name: "Item B" }]);
  });

  it("new managed items are bound to the session household", async () => {
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: "https://example.com/a",
      itemTypeCode: "contract",
      kindCode: "service",
      name: "A contract",
    });
    const aItems = await listManagedItems(db, householdAMember);
    const bItems = await listManagedItems(db, householdBMember);
    expect(aItems.map(({ name }) => name)).toContain("A contract");
    expect(bItems.map(({ name }) => name)).not.toContain("A contract");
  });

  it("a failed external-link insert rolls back the managed item insert", async () => {
    await expect(createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: "not-a-url",
      itemTypeCode: "contract",
      kindCode: "service",
      name: "Must roll back",
    })).rejects.toThrow();
    await expect(db.prepare(
      "SELECT count(*) AS count FROM managed_items WHERE name = 'Must roll back'",
    ).first<{ count: number }>()).resolves.toMatchObject({ count: 0 });
  });

  it("updateManagedItem replaces the external link atomically without touching household B(Issue #40)", async () => {
    await updateManagedItem(db, householdAMember, "item-a", {
      customItemType: null,
      externalUrl: "https://example.com/updated",
      itemTypeCode: "appliance",
      kindCode: "asset",
      name: "Item A updated",
    });

    await expect(getManagedItemForEdit(db, householdAMember, "item-a")).resolves.toEqual({
      customItemType: null,
      externalUrl: "https://example.com/updated",
      id: "item-a",
      itemTypeCode: "appliance",
      itemTypeLabel: "家電",
      kindCode: "asset",
      kindLabel: "モノ",
      name: "Item A updated",
    });
    await expect(db.prepare(
      "SELECT count(*) AS count FROM external_links WHERE managed_item_id = 'item-a'",
    ).first<{ count: number }>()).resolves.toMatchObject({ count: 1 });
    await expect(getManagedItemForEdit(db, householdBMember, "item-b")).resolves.toEqual({
      customItemType: null,
      externalUrl: null,
      id: "item-b",
      itemTypeCode: "other",
      itemTypeLabel: "その他",
      kindCode: "other",
      kindLabel: "その他",
      name: "Item B",
    });
  });

  it("updateManagedItem can unset the external link", async () => {
    await updateManagedItem(db, householdAMember, "item-a", {
      customItemType: null,
      externalUrl: "https://example.com/first",
      itemTypeCode: "other",
      kindCode: "other",
      name: "Item A",
    });
    await updateManagedItem(db, householdAMember, "item-a", {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "other",
      kindCode: "other",
      name: "Item A",
    });

    await expect(db.prepare(
      "SELECT count(*) AS count FROM external_links WHERE managed_item_id = 'item-a'",
    ).first<{ count: number }>()).resolves.toMatchObject({ count: 0 });
  });

  it("an A session cannot update or read a B item by ID (IDOR)", async () => {
    await expect(updateManagedItem(db, householdAMember, "item-b", {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "other",
      kindCode: "other",
      name: "Hacked",
    })).rejects.toThrow("管理対象が見つかりません。");
    await expect(getManagedItemForEdit(db, householdAMember, "item-b")).resolves.toBeNull();
    await expect(db.prepare(
      "SELECT name FROM managed_items WHERE id = 'item-b'",
    ).first()).resolves.toMatchObject({ name: "Item B" });
  });

  it("a failed external-link insert rolls back the managed item name/kind update too", async () => {
    await updateManagedItem(db, householdAMember, "item-a", {
      customItemType: null,
      externalUrl: "https://example.com/original",
      itemTypeCode: "other",
      kindCode: "other",
      name: "Item A",
    });

    await expect(updateManagedItem(db, householdAMember, "item-a", {
      customItemType: null,
      externalUrl: "not-a-url",
      itemTypeCode: "appliance",
      kindCode: "asset",
      name: "Should not persist",
    })).rejects.toThrow();

    await expect(getManagedItemForEdit(db, householdAMember, "item-a")).resolves.toEqual({
      customItemType: null,
      externalUrl: "https://example.com/original",
      id: "item-a",
      itemTypeCode: "other",
      itemTypeLabel: "その他",
      kindCode: "other",
      kindLabel: "その他",
      name: "Item A",
    });
  });

  it("profiles are account-scoped and duplicate submission is idempotent", async () => {
    await createProfile(db, householdAMember, "Alice");
    await createProfile(db, householdAMember, "Ignored duplicate");
    await updateProfile(db, householdAMember, "Alice updated");
    await expect(db.prepare(
      "SELECT nickname FROM profiles WHERE user_id = 'user-a'",
    ).first()).resolves.toMatchObject({ nickname: "Alice updated" });
    await expect(db.prepare(
      "SELECT count(*) AS count FROM profiles WHERE user_id = 'user-b'",
    ).first<{ count: number }>()).resolves.toMatchObject({ count: 0 });
  });

  it("first-household creation derives membership from the session", async () => {
    await createFirstHousehold(db, nonMember, "Outsider household");
    await expect(db.prepare(
      "SELECT h.name FROM households h JOIN household_members m ON m.household_id = h.id WHERE m.user_id = 'user-outsider'",
    ).first()).resolves.toMatchObject({ name: "Outsider household" });
  });

  it("a household insert failure does not leave a membership", async () => {
    await expect(createFirstHousehold(db, nonMember, ""))
      .rejects.toThrow();
    await expect(db.prepare(
      "SELECT count(*) AS count FROM household_members WHERE user_id = 'user-outsider'",
    ).first<{ count: number }>()).resolves.toMatchObject({ count: 0 });
  });
});

describe("D1 Todo atomicity and IDOR resistance", () => {
  it("creates unlinked one-time and calendar tasks in the session household", async () => {
    await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-09-01T15:00:00.000Z",
      title: "A one-time task",
    });
    await createCalendarTask(db, householdBMember, {
      managedItemId: null,
      scheduleDayOfMonth: null,
      scheduleDayOfWeek: 1,
      scheduleKind: "weekly",
      scheduleMonth: null,
      scheduleWeekOfMonth: null,
      title: "B calendar task",
    }, new Date("2026-08-20T00:00:00.000Z"));
    const rows = await db.prepare(
      "SELECT household_id, title FROM task_rules ORDER BY household_id",
    ).all<{ household_id: string; title: string }>();
    expect(rows.results).toEqual([
      { household_id: "household-a", title: "A one-time task" },
      { household_id: "household-b", title: "B calendar task" },
    ]);
  });

  it("completion atomically records the log and next occurrence, then undo restores it", async () => {
    const { occurrenceId, ruleId } = await createHouseholdAMaintenanceTask();
    const nextId = await completeTask(db, householdAMember, {
      idempotencyKey: "complete-success",
      occurredAt: "2026-08-05T00:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    });
    expect(nextId).not.toBeNull();
    await expect(db.prepare(
      "SELECT status FROM task_occurrences WHERE id = ?1 AND household_id = 'household-a'",
    ).bind(occurrenceId).first()).resolves.toMatchObject({ status: "completed" });
    await expect(db.prepare(
      "SELECT status FROM task_occurrences WHERE id = ?1 AND task_rule_id = ?2",
    ).bind(nextId, ruleId).first()).resolves.toMatchObject({ status: "pending" });

    await undoTaskCompletion(db, householdAMember, occurrenceId, "undo-success");
    await expect(db.prepare(
      "SELECT status FROM task_occurrences WHERE id = ?1",
    ).bind(occurrenceId).first()).resolves.toMatchObject({ status: "pending" });
    await expect(db.prepare(
      "SELECT id FROM task_occurrences WHERE id = ?1",
    ).bind(nextId).first()).resolves.toBeNull();
  });

  it("a next-occurrence constraint failure rolls back completion and its log", async () => {
    const { occurrenceId, ruleId } = await createHouseholdAMaintenanceTask();
    await db.prepare(
      `INSERT INTO task_occurrences (
        id, household_id, task_rule_id, scheduled_for, due_at, status
      ) VALUES ('collision', 'household-a', ?1, '2026-08-05T15:00:00.000Z', '2026-08-06T15:00:00.000Z', 'skipped')`,
    ).bind(ruleId).run();

    await expect(completeTask(db, householdAMember, {
      idempotencyKey: "complete-collision",
      occurredAt: "2026-08-05T00:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    })).rejects.toThrow("already exists for the computed schedule");
    await expect(db.prepare(
      "SELECT status FROM task_occurrences WHERE id = ?1",
    ).bind(occurrenceId).first()).resolves.toMatchObject({ status: "pending" });
    await expect(db.prepare(
      "SELECT count(*) AS count FROM activity_logs WHERE idempotency_key = 'complete-collision'",
    ).first<{ count: number }>()).resolves.toMatchObject({ count: 0 });
  });

  it("modified next occurrence makes undo fail without partial deletion", async () => {
    const { occurrenceId } = await createHouseholdAMaintenanceTask();
    const nextId = await completeTask(db, householdAMember, {
      idempotencyKey: "complete-before-modified-undo",
      occurredAt: "2026-08-05T00:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    });
    if (nextId === null) throw new Error("Expected a next occurrence");
    await setTaskOccurrenceAssignee(db, householdAMember, nextId, "user-a");

    await expect(undoTaskCompletion(
      db, householdAMember, occurrenceId, "undo-modified",
    )).rejects.toThrow("Next occurrence has been modified");
    await expect(db.prepare(
      "SELECT status FROM task_occurrences WHERE id = ?1",
    ).bind(occurrenceId).first()).resolves.toMatchObject({ status: "completed" });
    await expect(db.prepare(
      "SELECT status FROM task_occurrences WHERE id = ?1",
    ).bind(nextId).first()).resolves.toMatchObject({ status: "pending" });
  });

  it("担当変更と延期の前後値を追記型履歴へ保持する", async () => {
    const { occurrenceId } = await createHouseholdAMaintenanceTask();
    await setTaskOccurrenceAssignee(db, householdAMember, occurrenceId, "user-a");
    await postponeTaskOccurrence(
      db,
      householdAMember,
      occurrenceId,
      "2027-01-01T00:00:00.000Z",
    );

    await expect(db.prepare(
      `SELECT assignee_user_id, previous_assignee_user_id, new_assignee_user_id
         FROM activity_logs WHERE task_occurrence_id = ?1 AND action = 'assignee_changed'`,
    ).bind(occurrenceId).first()).resolves.toMatchObject({
      assignee_user_id: "user-a",
      new_assignee_user_id: "user-a",
      previous_assignee_user_id: null,
    });
    await expect(db.prepare(
      `SELECT previous_due_at, new_due_at
         FROM activity_logs WHERE task_occurrence_id = ?1 AND action = 'postponed'`,
    ).bind(occurrenceId).first()).resolves.toMatchObject({
      new_due_at: "2027-01-01T00:00:00.000Z",
      previous_due_at: "2026-08-10T15:00:00.000Z",
    });
  });

  it("「やるよ」は未担当のOccurrenceを操作主体自身の担当にし、追記型履歴を残す(Issue #77)", async () => {
    const { occurrenceId } = await createHouseholdAMaintenanceTask();

    await claimTaskOccurrenceAssignee(db, householdAMember, occurrenceId);

    await expect(db.prepare(
      "SELECT assignee_user_id FROM task_occurrences WHERE id = ?1",
    ).bind(occurrenceId).first()).resolves.toMatchObject({ assignee_user_id: "user-a" });
    await expect(db.prepare(
      `SELECT actor_user_id, assignee_user_id, previous_assignee_user_id, new_assignee_user_id
         FROM activity_logs WHERE task_occurrence_id = ?1 AND action = 'assignee_changed'`,
    ).bind(occurrenceId).first()).resolves.toMatchObject({
      actor_user_id: "user-a",
      assignee_user_id: "user-a",
      new_assignee_user_id: "user-a",
      previous_assignee_user_id: null,
    });
  });

  it("既に担当者がいれば「やるよ」は黙って上書きせず、後着だけ失敗する(同時操作の安全性、Issue #77)", async () => {
    await db.batch([
      db.prepare("INSERT INTO users (id, email) VALUES ('user-a2','a2@example.com')"),
      db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a','user-a2')"),
    ]);
    const { occurrenceId } = await createHouseholdAMaintenanceTask();
    const secondMember = { email: "a2@example.com", userId: "user-a2" };

    await claimTaskOccurrenceAssignee(db, householdAMember, occurrenceId);
    await expect(claimTaskOccurrenceAssignee(db, secondMember, occurrenceId))
      .rejects.toThrow("Occurrence already has an assignee");

    await expect(db.prepare(
      "SELECT assignee_user_id FROM task_occurrences WHERE id = ?1",
    ).bind(occurrenceId).first()).resolves.toMatchObject({ assignee_user_id: "user-a" });
    await expect(db.prepare(
      "SELECT count(*) AS count FROM activity_logs WHERE task_occurrence_id = ?1 AND action = 'assignee_changed'",
    ).bind(occurrenceId).first<{ count: number }>()).resolves.toMatchObject({ count: 1 });
  });

  it("A session cannot complete, assign, or postpone a B occurrence by ID", async () => {
    const bRuleId = await createMaintenanceTask(db, householdBMember, {
      firstDueAt: "2026-09-10T15:00:00.000Z",
      firstScheduledFor: "2026-09-01T15:00:00.000Z",
      managedItemId: "item-b",
      recommendedStartOffset: 1,
      recommendedUntilOffset: 2,
      title: "B maintenance",
    });
    const bOccurrence = await occurrenceForRule(bRuleId);
    await expect(completeTask(db, householdAMember, {
      idempotencyKey: "idor-complete",
      occurredAt: "2026-08-05T00:00:00.000Z",
      occurrenceId: bOccurrence.id,
      performedByUserId: null,
    })).rejects.toThrow("Occurrence not found");
    await expect(setTaskOccurrenceAssignee(
      db, householdAMember, bOccurrence.id, "user-a",
    )).rejects.toThrow("Occurrence not found");
    await expect(claimTaskOccurrenceAssignee(
      db, householdAMember, bOccurrence.id,
    )).rejects.toThrow("Occurrence not found");
    await expect(postponeTaskOccurrence(
      db, householdAMember, bOccurrence.id, "2027-01-01T00:00:00.000Z",
    )).rejects.toThrow("Occurrence not found");
    await expect(correctCompletionOccurredAt(
      db, householdAMember, bOccurrence.id, "idor-correct-occurred-at", "2026-08-05T00:00:00.000Z",
    )).rejects.toThrow("Occurrence not found");
    await expect(correctCompletionPerformer(
      db, householdAMember, bOccurrence.id, "idor-correct-performer", "user-a",
    )).rejects.toThrow("Occurrence not found");
    await expect(db.prepare(
      "SELECT status, assignee_user_id FROM task_occurrences WHERE id = ?1",
    ).bind(bOccurrence.id).first()).resolves.toMatchObject({
      assignee_user_id: null,
      status: "pending",
    });
  });
});

describe("D1 completion correction atomicity and household isolation (Issue #148)", () => {
  it("実施日時の訂正は未変更の次回Occurrenceを原子的に再計算し、追記型で履歴を残す(Issue #148)", async () => {
    const { occurrenceId } = await createHouseholdAMaintenanceTask();
    const nextId = await completeTask(db, householdAMember, {
      idempotencyKey: "correct-recalc-complete",
      occurredAt: "2026-08-05T00:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    });
    if (nextId === null) throw new Error("Expected a next occurrence");
    const before = await db.prepare(
      "SELECT scheduled_for, due_at FROM task_occurrences WHERE id = ?1",
    ).bind(nextId).first<{ due_at: string; scheduled_for: string }>();

    await correctCompletionOccurredAt(
      db, householdAMember, occurrenceId, "correct-recalc", "2026-08-09T00:00:00.000Z",
    );

    const after = await db.prepare(
      "SELECT scheduled_for, due_at FROM task_occurrences WHERE id = ?1",
    ).bind(nextId).first<{ due_at: string; scheduled_for: string }>();
    expect(after?.scheduled_for).not.toBe(before?.scheduled_for);
    expect(after?.due_at).not.toBe(before?.due_at);
    await expect(db.prepare(
      `SELECT previous_occurred_at, new_occurred_at, new_performed_by_user_id
         FROM completion_corrections WHERE task_occurrence_id = ?1`,
    ).bind(occurrenceId).first()).resolves.toMatchObject({
      new_occurred_at: "2026-08-09T00:00:00.000Z",
      new_performed_by_user_id: null,
      previous_occurred_at: "2026-08-05T00:00:00.000Z",
    });
    // 元のcompletedログ自体は書き換えない。
    await expect(db.prepare(
      "SELECT occurred_at FROM activity_logs WHERE task_occurrence_id = ?1 AND action = 'completed'",
    ).bind(occurrenceId).first()).resolves.toMatchObject({
      occurred_at: "2026-08-05T00:00:00.000Z",
    });
  });

  it("次回Occurrenceが変更済みなら実施日時の訂正を拒否し、データを変更しない", async () => {
    const { occurrenceId } = await createHouseholdAMaintenanceTask();
    const nextId = await completeTask(db, householdAMember, {
      idempotencyKey: "correct-modified-complete",
      occurredAt: "2026-08-05T00:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    });
    if (nextId === null) throw new Error("Expected a next occurrence");
    await setTaskOccurrenceAssignee(db, householdAMember, nextId, "user-a");

    await expect(correctCompletionOccurredAt(
      db, householdAMember, occurrenceId, "correct-modified", "2026-08-09T00:00:00.000Z",
    )).rejects.toThrow("Next occurrence has been modified");

    await expect(db.prepare(
      "SELECT count(*) AS count FROM completion_corrections WHERE task_occurrence_id = ?1",
    ).bind(occurrenceId).first<{ count: number }>()).resolves.toMatchObject({ count: 0 });
    await expect(db.prepare(
      "SELECT occurred_at FROM activity_logs WHERE task_occurrence_id = ?1 AND action = 'completed'",
    ).bind(occurrenceId).first()).resolves.toMatchObject({
      occurred_at: "2026-08-05T00:00:00.000Z",
    });
  });

  it("実施者の訂正は同じ家庭のメンバーだけを許可し、元のcompletedログを書き換えない", async () => {
    await db.batch([
      db.prepare("INSERT INTO users (id, email) VALUES ('user-a2','a2@example.com')"),
      db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a','user-a2')"),
    ]);
    const { occurrenceId } = await createHouseholdAMaintenanceTask();
    await completeTask(db, householdAMember, {
      idempotencyKey: "correct-performer-complete",
      occurredAt: "2026-08-05T00:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    });

    await expect(correctCompletionPerformer(
      db, householdAMember, occurrenceId, "correct-performer-outsider", "user-b",
    )).rejects.toThrow("Performer not found");

    await correctCompletionPerformer(db, householdAMember, occurrenceId, "correct-performer", "user-a2");

    await expect(db.prepare(
      "SELECT performed_by_user_id FROM activity_logs WHERE task_occurrence_id = ?1 AND action = 'completed'",
    ).bind(occurrenceId).first()).resolves.toMatchObject({ performed_by_user_id: "user-a" });
    await expect(db.prepare(
      `SELECT previous_performed_by_user_id, new_performed_by_user_id
         FROM completion_corrections WHERE task_occurrence_id = ?1`,
    ).bind(occurrenceId).first()).resolves.toMatchObject({
      new_performed_by_user_id: "user-a2",
      previous_performed_by_user_id: "user-a",
    });
  });

  it("同じidempotency_keyの再送は訂正を重複させず、別Occurrenceへの使い回しは拒否する", async () => {
    const first = await createHouseholdAMaintenanceTask();
    await completeTask(db, householdAMember, {
      idempotencyKey: "correct-idem-complete-1",
      occurredAt: "2026-08-05T00:00:00.000Z",
      occurrenceId: first.occurrenceId,
      performedByUserId: null,
    });

    await correctCompletionOccurredAt(
      db, householdAMember, first.occurrenceId, "correct-idem", "2026-08-06T00:00:00.000Z",
    );
    await correctCompletionOccurredAt(
      db, householdAMember, first.occurrenceId, "correct-idem", "2026-08-06T00:00:00.000Z",
    );
    await expect(db.prepare(
      "SELECT count(*) AS count FROM completion_corrections WHERE idempotency_key = 'correct-idem'",
    ).first<{ count: number }>()).resolves.toMatchObject({ count: 1 });

    const second = await createHouseholdAMaintenanceTask();
    await completeTask(db, householdAMember, {
      idempotencyKey: "correct-idem-complete-2",
      occurredAt: "2026-08-05T00:00:00.000Z",
      occurrenceId: second.occurrenceId,
      performedByUserId: null,
    });
    await expect(correctCompletionOccurredAt(
      db, householdAMember, second.occurrenceId, "correct-idem", "2026-08-06T00:00:00.000Z",
    )).rejects.toThrow("Idempotency key was already used for a different occurrence");
  });
});

describe("D1 invitation issuance and household isolation", () => {
  it("stores only the token hash and reissue replaces the previous pending invitation", async () => {
    const first = await issueHouseholdInvitation(
      db, householdAMember, " Guest@Example.com ", new Date("2026-08-20T00:00:00.000Z"),
    );
    const second = await issueHouseholdInvitation(
      db, householdAMember, "guest@example.com", new Date("2026-08-21T00:00:00.000Z"),
    );
    const rows = await db.prepare(
      "SELECT id, token_hash, status FROM household_invitations WHERE household_id = 'household-a' ORDER BY created_at",
    ).all<{ id: string; status: string; token_hash: string }>();
    expect(first.token).not.toBe(second.token);
    expect(rows.results).toHaveLength(2);
    expect(rows.results[0]).toMatchObject({ id: first.invitationId, status: "replaced" });
    expect(rows.results[1]).toMatchObject({ id: second.invitationId, status: "pending" });
    expect(rows.results.some(({ token_hash: hash }) => hash === first.token || hash === second.token))
      .toBe(false);
  });

  it("a failed reissue rolls back replacement of the existing invitation", async () => {
    const first = await issueHouseholdInvitation(db, householdAMember, "guest@example.com");
    await expect(issueHouseholdInvitation(db, householdAMember, "x"))
      .rejects.toThrow();
    await expect(db.prepare(
      "SELECT status FROM household_invitations WHERE id = ?1",
    ).bind(first.invitationId).first()).resolves.toMatchObject({ status: "pending" });
  });

  it("lists and cancels only invitations in the current household", async () => {
    const a = await issueHouseholdInvitation(db, householdAMember, "a-guest@example.com");
    const b = await issueHouseholdInvitation(db, householdBMember, "b-guest@example.com");
    await expect(cancelHouseholdInvitation(db, householdAMember, b.invitationId))
      .rejects.toThrow("Invitation is not pending");
    expect((await listHouseholdInvitations(db, householdAMember)).map(({ id }) => id))
      .toEqual([a.invitationId]);
    expect((await listHouseholdInvitations(db, householdBMember)).map(({ id }) => id))
      .toEqual([b.invitationId]);
    await cancelHouseholdInvitation(db, householdAMember, a.invitationId);
    await expect(db.prepare(
      "SELECT status FROM household_invitations WHERE id = ?1",
    ).bind(b.invitationId).first()).resolves.toMatchObject({ status: "pending" });
  });
});

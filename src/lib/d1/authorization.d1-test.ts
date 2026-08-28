import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import schemaSql from "../../../d1/migrations/0001_init.sql?raw";
import authSchemaSql from "../../../d1/migrations/0002_auth_invitation_claims.sql?raw";
import migrationAuditSql from "../../../d1/migrations/0003_preserve_supabase_audit_fields.sql?raw";
import completionCorrectionsSql from "../../../d1/migrations/0004_completion_corrections.sql?raw";
import classificationSql from "../../../d1/migrations/0005_managed_item_classification.sql?raw";
import propertyTaxSql from "../../../d1/migrations/0006_property_tax_item_type.sql?raw";
import kindLabelsSql from "../../../d1/migrations/0007_managed_item_kind_labels.sql?raw";
import optionalAttributesSql from "../../../d1/migrations/0008_managed_item_optional_attributes.sql?raw";
import undatedTodosSql from "../../../d1/migrations/0009_undated_one_time_todos.sql?raw";
import monthEndSql from "../../../d1/migrations/0010_monthly_day_month_end.sql?raw";
import startedOnSql from "../../../d1/migrations/0011_managed_item_started_on.sql?raw";
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
import { listPendingOccurrences, listRecentActiveCompletions } from "./home";
import {
  createManagedItem,
  getManagedItem,
  getManagedItemForEdit,
  listHouseholdCustomItemTypes,
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
  setOneTimeTaskSchedule,
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
    optionalAttributesSql,
  ].join("\n")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function triggerAwareStatements(sql: string): string[] {
  const cleaned = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  const triggers = [...cleaned.matchAll(/CREATE TRIGGER[\s\S]*?END;/g)]
    .map(([statement]) => statement.trim());
  const regular = cleaned
    .replaceAll(/CREATE TRIGGER[\s\S]*?END;/g, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  return [...regular, ...triggers];
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
  await db.batch(triggerAwareStatements(undatedTodosSql).map((statement) => db.prepare(statement)));
  await db.batch(triggerAwareStatements(monthEndSql).map((statement) => db.prepare(statement)));
  await db.batch(triggerAwareStatements(startedOnSql).map((statement) => db.prepare(statement)));
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

});

// ManagedItemの書き込みは家庭境界・原子性ともに独立した関心事のため、
// 一つのdescribeへまとめる(Issue #42で任意の記録が加わり分割した)。
describe("D1 ManagedItem writes and household isolation", () => {
  it("new managed items are bound to the session household", async () => {
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: "https://example.com/a",
      itemTypeCode: "contract",
      kindCode: "service",
      name: "A contract",
      note: null,
      productInfo: null,
      startedOn: null,
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
      note: null,
      productInfo: null,
      startedOn: null,
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
      note: null,
      productInfo: null,
      startedOn: null,
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
      note: null,
      productInfo: null,
      startedOn: null,
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
      note: null,
      productInfo: null,
      startedOn: null,
    });
  });

  it("updateManagedItem can unset the external link", async () => {
    await updateManagedItem(db, householdAMember, "item-a", {
      customItemType: null,
      externalUrl: "https://example.com/first",
      itemTypeCode: "other",
      kindCode: "other",
      name: "Item A",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    await updateManagedItem(db, householdAMember, "item-a", {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "other",
      kindCode: "other",
      name: "Item A",
      note: null,
      productInfo: null,
      startedOn: null,
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
      note: null,
      productInfo: null,
      startedOn: null,
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
      note: null,
      productInfo: null,
      startedOn: null,
    });

    await expect(updateManagedItem(db, householdAMember, "item-a", {
      customItemType: null,
      externalUrl: "not-a-url",
      itemTypeCode: "appliance",
      kindCode: "asset",
      name: "Should not persist",
      note: null,
      productInfo: null,
      startedOn: null,
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
      note: null,
      productInfo: null,
      startedOn: null,
    });
  });

});

describe("D1 profile and household creation", () => {
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

describe("D1 undated one-time Todo constraints and authorization", () => {
  it("他家庭の管理対象へ日付未定Todoを作成できず、一覧にも混在しない", async () => {
    await expect(createOneTimeTask(db, householdAMember, {
      managedItemId: "item-b",
      scheduledFor: null,
      title: "Cross-household task",
    })).rejects.toThrow("Managed item not found");

    const bRuleId = await createOneTimeTask(db, householdBMember, {
      managedItemId: null,
      scheduledFor: null,
      title: "B undated task",
    });
    const bOccurrence = await occurrenceForRule(bRuleId);

    expect((await listPendingOccurrences(db, householdAMember)).map(({ id }) => id))
      .not.toContain(bOccurrence.id);
    expect((await listPendingOccurrences(db, householdBMember)).map(({ id }) => id))
      .toContain(bOccurrence.id);
  });

  it("日付未定の一回限りTodoを作成し、未定のまま完了して次回を作らない", async () => {
    const ruleId = await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: null,
      title: "Undated one-time task",
    });
    const occurrence = await occurrenceForRule(ruleId);

    await expect(db.prepare(
      "SELECT scheduled_for, due_at, status FROM task_occurrences WHERE id = ?1",
    ).bind(occurrence.id).first()).resolves.toMatchObject({
      due_at: null,
      scheduled_for: null,
      status: "pending",
    });

    const nextId = await completeTask(db, householdAMember, {
      idempotencyKey: "complete-undated",
      occurredAt: "2026-08-05T00:00:00.000Z",
      occurrenceId: occurrence.id,
      performedByUserId: null,
    });

    expect(nextId).toBeNull();
    await expect(db.prepare(
      "SELECT count(*) AS count FROM task_occurrences WHERE task_rule_id = ?1",
    ).bind(ruleId).first<{ count: number }>()).resolves.toMatchObject({ count: 1 });
    await expect(db.prepare(
      "SELECT action FROM activity_logs WHERE task_occurrence_id = ?1",
    ).bind(occurrence.id).first()).resolves.toMatchObject({ action: "completed" });
  });

  it("片方だけがNULLのOccurrenceと、繰り返しTodoの日付NULLを拒否する", async () => {
    await db.prepare(
      "INSERT INTO task_rules (id, household_id, title, recurrence_basis, deadline_kind) VALUES ('once-null-rule', 'household-a', 'Once', 'once', 'strict')",
    ).run();
    await expect(db.prepare(
      "INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at) VALUES ('half-null', 'household-a', 'once-null-rule', NULL, '2026-09-01T00:00:00.000Z')",
    ).run()).rejects.toThrow();

    await db.prepare(
      "INSERT INTO task_rules (id, household_id, title, recurrence_basis, deadline_kind, recommended_start_offset, recommended_until_offset) VALUES ('repeat-null-rule', 'household-a', 'Repeat', 'completion', 'maintenance', 1, 2)",
    ).run();
    await expect(db.prepare(
      "INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at) VALUES ('repeat-null', 'household-a', 'repeat-null-rule', NULL, NULL)",
    ).run()).rejects.toThrow();
  });

  it("一回限りTodoの予定日を設定・未定化し、他家庭からの変更を拒否する", async () => {
    const ruleId = await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: null,
      title: "Undated one-time task",
    });
    const occurrence = await occurrenceForRule(ruleId);
    await setOneTimeTaskSchedule(
      db, householdAMember, occurrence.id, "2026-09-01T15:00:00.000Z",
    );
    await expect(db.prepare(
      "SELECT scheduled_for, due_at FROM task_occurrences WHERE id = ?1",
    ).bind(occurrence.id).first()).resolves.toMatchObject({
      due_at: "2026-09-01T15:00:00.000Z",
      scheduled_for: "2026-09-01T15:00:00.000Z",
    });

    await expect(setOneTimeTaskSchedule(
      db, householdBMember, occurrence.id, null,
    )).rejects.toThrow("Occurrence not found");
    await setOneTimeTaskSchedule(db, householdAMember, occurrence.id, null);
    await expect(db.prepare(
      "SELECT scheduled_for, due_at FROM task_occurrences WHERE id = ?1",
    ).bind(occurrence.id).first()).resolves.toMatchObject({
      due_at: null,
      scheduled_for: null,
    });
  });
});

describe("D1 recent completions authorization (Issue #222)", () => {
  it("実施済みの取得は所属家庭のOccurrenceだけに限る", async () => {
    const aRuleId = await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-08-01T15:00:00.000Z",
      title: "A task",
    });
    const aOccurrence = await occurrenceForRule(aRuleId);
    await completeTask(db, householdAMember, {
      idempotencyKey: "complete-a",
      occurredAt: "2026-08-02T00:00:00.000Z",
      occurrenceId: aOccurrence.id,
      performedByUserId: null,
    });

    const bRuleId = await createOneTimeTask(db, householdBMember, {
      managedItemId: null,
      scheduledFor: "2026-08-01T15:00:00.000Z",
      title: "B task",
    });
    const bOccurrence = await occurrenceForRule(bRuleId);
    await completeTask(db, householdBMember, {
      idempotencyKey: "complete-b",
      occurredAt: "2026-08-02T00:00:00.000Z",
      occurrenceId: bOccurrence.id,
      performedByUserId: null,
    });

    const aCompletions = await listRecentActiveCompletions(db, householdAMember, 20);
    expect(aCompletions.map((row) => row.task_occurrence_id)).toContain(aOccurrence.id);
    expect(aCompletions.map((row) => row.task_occurrence_id)).not.toContain(bOccurrence.id);

    const bCompletions = await listRecentActiveCompletions(db, householdBMember, 20);
    expect(bCompletions.map((row) => row.task_occurrence_id)).toContain(bOccurrence.id);
    expect(bCompletions.map((row) => row.task_occurrence_id)).not.toContain(aOccurrence.id);
  });

  it("完了取消後は実施済み一覧から外れ、未完了一覧へ戻る", async () => {
    const ruleId = await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-08-01T15:00:00.000Z",
      title: "Undo task",
    });
    const occurrence = await occurrenceForRule(ruleId);
    await completeTask(db, householdAMember, {
      idempotencyKey: "complete-undo",
      occurredAt: "2026-08-02T00:00:00.000Z",
      occurrenceId: occurrence.id,
      performedByUserId: null,
    });
    expect(
      (await listRecentActiveCompletions(db, householdAMember, 20))
        .map((row) => row.task_occurrence_id),
    ).toContain(occurrence.id);

    await undoTaskCompletion(db, householdAMember, occurrence.id, "undo-1");

    expect(
      (await listRecentActiveCompletions(db, householdAMember, 20))
        .map((row) => row.task_occurrence_id),
    ).not.toContain(occurrence.id);
    expect((await listPendingOccurrences(db, householdAMember)).map((row) => row.id))
      .toContain(occurrence.id);
  });
});

describe("D1 assignee filter authorization (Issue #223)", () => {
  async function addSecondHouseholdAMember(): Promise<{ email: string; userId: string }> {
    await db.batch([
      db.prepare("INSERT INTO users (id, email) VALUES ('user-a2','a2@example.com')"),
      db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a','user-a2')"),
    ]);
    return { email: "a2@example.com", userId: "user-a2" };
  }

  it("担当予定者(自分・家族・担当未定)で未完了Todoを絞り込む", async () => {
    const memberA2 = await addSecondHouseholdAMember();
    const unassignedRuleId = await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-08-01T15:00:00.000Z",
      title: "Unassigned task",
    });
    const unassignedOccurrence = await occurrenceForRule(unassignedRuleId);

    const selfRuleId = await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-08-01T15:00:00.000Z",
      title: "Self task",
    });
    const selfOccurrence = await occurrenceForRule(selfRuleId);
    await setTaskOccurrenceAssignee(db, householdAMember, selfOccurrence.id, "user-a");

    const otherRuleId = await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-08-01T15:00:00.000Z",
      title: "Other member task",
    });
    const otherOccurrence = await occurrenceForRule(otherRuleId);
    await setTaskOccurrenceAssignee(db, householdAMember, otherOccurrence.id, "user-a2");

    const selfFiltered = await listPendingOccurrences(
      db, householdAMember, { type: "member", userId: "user-a" },
    );
    expect(selfFiltered.map((row) => row.id)).toEqual([selfOccurrence.id]);

    const otherFiltered = await listPendingOccurrences(
      db, householdAMember, { type: "member", userId: memberA2.userId },
    );
    expect(otherFiltered.map((row) => row.id)).toEqual([otherOccurrence.id]);

    const unassignedFiltered = await listPendingOccurrences(
      db, householdAMember, { type: "unassigned" },
    );
    expect(unassignedFiltered.map((row) => row.id)).toEqual([unassignedOccurrence.id]);
  });

  it("別家庭のuserIdや存在しないuserIdを指定しても、家庭内のTodoは漏れない", async () => {
    await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-08-01T15:00:00.000Z",
      title: "A task",
    });
    const bRuleId = await createOneTimeTask(db, householdBMember, {
      managedItemId: null,
      scheduledFor: "2026-08-01T15:00:00.000Z",
      title: "B task",
    });
    const bOccurrence = await occurrenceForRule(bRuleId);
    await setTaskOccurrenceAssignee(db, householdBMember, bOccurrence.id, "user-b");

    // 家庭Bのメンバーで家庭Aの一覧を絞り込んでも、家庭Bの担当情報は漏れない
    // (household_idによる絞り込みが先に効くため0件になる)。
    await expect(
      listPendingOccurrences(db, householdAMember, { type: "member", userId: "user-b" }),
    ).resolves.toEqual([]);
    // 実在しないuserIdでも同様に0件になるだけで、エラーにも全件表示にもならない。
    await expect(
      listPendingOccurrences(db, householdAMember, { type: "member", userId: "no-such-user" }),
    ).resolves.toEqual([]);
  });

  it("担当予定者(自分・担当未定)で実施済みTodoを絞り込む", async () => {
    const assignedRuleId = await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-08-01T15:00:00.000Z",
      title: "Assigned then completed",
    });
    const assignedOccurrence = await occurrenceForRule(assignedRuleId);
    await setTaskOccurrenceAssignee(db, householdAMember, assignedOccurrence.id, "user-a");
    await completeTask(db, householdAMember, {
      idempotencyKey: "complete-assigned",
      occurredAt: "2026-08-02T00:00:00.000Z",
      occurrenceId: assignedOccurrence.id,
      performedByUserId: null,
    });

    const unassignedRuleId = await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-08-01T15:00:00.000Z",
      title: "Unassigned then completed",
    });
    const unassignedOccurrence = await occurrenceForRule(unassignedRuleId);
    await completeTask(db, householdAMember, {
      idempotencyKey: "complete-unassigned",
      occurredAt: "2026-08-02T00:00:00.000Z",
      occurrenceId: unassignedOccurrence.id,
      performedByUserId: null,
    });

    const selfFiltered = await listRecentActiveCompletions(
      db, householdAMember, 20, { type: "member", userId: "user-a" },
    );
    expect(selfFiltered.map((row) => row.task_occurrence_id)).toEqual([assignedOccurrence.id]);

    const unassignedFiltered = await listRecentActiveCompletions(
      db, householdAMember, 20, { type: "unassigned" },
    );
    expect(unassignedFiltered.map((row) => row.task_occurrence_id))
      .toEqual([unassignedOccurrence.id]);
  });
});

describe("D1 title search authorization (Issue #225)", () => {
  it("Todo名の部分一致(日本語)で未完了Todoを絞り込む", async () => {
    const matchRuleId = await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-08-01T15:00:00.000Z",
      title: "洗剤を補充する",
    });
    const matchOccurrence = await occurrenceForRule(matchRuleId);
    await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-08-01T15:00:00.000Z",
      title: "ゴミ出し",
    });

    const filtered = await listPendingOccurrences(db, householdAMember, undefined, "洗剤");
    expect(filtered.map((row) => row.id)).toEqual([matchOccurrence.id]);
  });

  it("英字の大文字・小文字を区別せず一致させる", async () => {
    const ruleId = await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-08-01T15:00:00.000Z",
      title: "AEDの点検",
    });
    const occurrence = await occurrenceForRule(ruleId);

    const lowerFiltered = await listPendingOccurrences(db, householdAMember, undefined, "aed");
    expect(lowerFiltered.map((row) => row.id)).toEqual([occurrence.id]);

    const upperFiltered = await listPendingOccurrences(db, householdAMember, undefined, "AED");
    expect(upperFiltered.map((row) => row.id)).toEqual([occurrence.id]);
  });

  it("前後の空白を無視し、空文字・空白のみは絞り込みなしとして扱う", async () => {
    await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-08-01T15:00:00.000Z",
      title: "洗剤を補充する",
    });

    const paddedResult = await listPendingOccurrences(db, householdAMember, undefined, "  洗剤  ");
    expect(paddedResult).toHaveLength(1);

    const blankResult = await listPendingOccurrences(db, householdAMember, undefined, "   ");
    expect(blankResult).toHaveLength(1);

    const emptyResult = await listPendingOccurrences(db, householdAMember, undefined, "");
    expect(emptyResult).toHaveLength(1);
  });

  it("検索語に含まれるLIKEのワイルドカード(%, _)を文字通りの部分文字列として扱う", async () => {
    const wildcardRuleId = await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-08-01T15:00:00.000Z",
      title: "10%OFFクーポンを使う",
    });
    const wildcardOccurrence = await occurrenceForRule(wildcardRuleId);
    await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-08-01T15:00:00.000Z",
      title: "10円玉OFFクーポンを使う",
    });

    // "%"を検索語に含めても、ワイルドカードとしてではなく文字通り一致させる
    // ため、"10%OFF"を含むTodoだけが一致し、"10"+任意文字+"OFF"に広く一致
    // する誤検出は起きない。
    const filtered = await listPendingOccurrences(db, householdAMember, undefined, "10%OFF");
    expect(filtered.map((row) => row.id)).toEqual([wildcardOccurrence.id]);
  });

  it("別家庭のTodoは検索結果へ混ざらない", async () => {
    await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-08-01T15:00:00.000Z",
      title: "共通のキーワード用A",
    });
    await createOneTimeTask(db, householdBMember, {
      managedItemId: null,
      scheduledFor: "2026-08-01T15:00:00.000Z",
      title: "共通のキーワード用B",
    });

    const filtered = await listPendingOccurrences(db, householdAMember, undefined, "共通のキーワード");
    expect(filtered).toHaveLength(1);
  });

  it("Todo名の部分一致で実施済みTodoを絞り込み、担当条件と組み合わせても機能する", async () => {
    const matchRuleId = await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-08-01T15:00:00.000Z",
      title: "洗剤を補充する",
    });
    const matchOccurrence = await occurrenceForRule(matchRuleId);
    await setTaskOccurrenceAssignee(db, householdAMember, matchOccurrence.id, "user-a");
    await completeTask(db, householdAMember, {
      idempotencyKey: "complete-match",
      occurredAt: "2026-08-02T00:00:00.000Z",
      occurrenceId: matchOccurrence.id,
      performedByUserId: null,
    });

    const otherRuleId = await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-08-01T15:00:00.000Z",
      title: "ゴミ出し",
    });
    const otherOccurrence = await occurrenceForRule(otherRuleId);
    await completeTask(db, householdAMember, {
      idempotencyKey: "complete-other",
      occurredAt: "2026-08-02T00:00:00.000Z",
      occurrenceId: otherOccurrence.id,
      performedByUserId: null,
    });

    const searchOnly = await listRecentActiveCompletions(db, householdAMember, 20, undefined, "洗剤");
    expect(searchOnly.map((row) => row.task_occurrence_id)).toEqual([matchOccurrence.id]);

    const searchAndAssignee = await listRecentActiveCompletions(
      db, householdAMember, 20, { type: "member", userId: "user-a" }, "洗剤",
    );
    expect(searchAndAssignee.map((row) => row.task_occurrence_id)).toEqual([matchOccurrence.id]);

    const searchNoMatchAssignee = await listRecentActiveCompletions(
      db, householdAMember, 20, { type: "unassigned" }, "洗剤",
    );
    expect(searchNoMatchAssignee).toEqual([]);
  });
});

describe("D1 台帳一覧の検索・絞り込み認可 (Issue #218)", () => {
  it("管理対象名の部分一致(日本語)で絞り込む", async () => {
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "other",
      kindCode: "other",
      name: "浄水フィルター",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    const filtered = await listManagedItems(db, householdAMember, { search: "浄水" });
    expect(filtered.map(({ name }) => name)).toEqual(["浄水フィルター"]);
  });

  it("英字の大文字・小文字を区別せず一致させる", async () => {
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "other",
      kindCode: "other",
      name: "AEDトレーナー",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    const lowerFiltered = await listManagedItems(db, householdAMember, { search: "aed" });
    expect(lowerFiltered.map(({ name }) => name)).toEqual(["AEDトレーナー"]);
  });

  it("前後の空白を無視し、空文字・空白のみは絞り込みなしとして扱う", async () => {
    const paddedResult = await listManagedItems(db, householdAMember, { search: "  Item  " });
    expect(paddedResult.map(({ name }) => name)).toEqual(["Item A"]);

    const blankResult = await listManagedItems(db, householdAMember, { search: "   " });
    expect(blankResult.map(({ name }) => name)).toEqual(["Item A"]);

    const emptyResult = await listManagedItems(db, householdAMember, { search: "" });
    expect(emptyResult.map(({ name }) => name)).toEqual(["Item A"]);
  });

  it("検索語に含まれるLIKEのワイルドカード(%, _)を文字通りの部分文字列として扱う", async () => {
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "other",
      kindCode: "other",
      name: "10%OFFクーポン家電",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "other",
      kindCode: "other",
      name: "10円玉OFFクーポン家電",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    const filtered = await listManagedItems(db, householdAMember, { search: "10%OFF" });
    expect(filtered.map(({ name }) => name)).toEqual(["10%OFFクーポン家電"]);
  });

  it("大分類(kindCode)で絞り込む", async () => {
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "appliance",
      kindCode: "asset",
      name: "冷蔵庫",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    const filtered = await listManagedItems(db, householdAMember, { kindCode: "asset" });
    expect(filtered.map(({ name }) => name)).toEqual(["冷蔵庫"]);
    // item-a(その他/その他)は大分類がasset以外なので一致しない。
    expect(filtered.map(({ name }) => name)).not.toContain("Item A");
  });

  it("詳しい種類(itemTypeCode)で絞り込み、カスタム入力(未設定)の詳しい種類は一致しない", async () => {
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "appliance",
      kindCode: "asset",
      name: "冷蔵庫",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    await createManagedItem(db, householdAMember, {
      customItemType: "特注の棚",
      externalUrl: null,
      itemTypeCode: null,
      kindCode: "asset",
      name: "オーダー家具",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    const filtered = await listManagedItems(db, householdAMember, { itemTypeCode: "appliance" });
    expect(filtered.map(({ name }) => name)).toEqual(["冷蔵庫"]);
  });

  it("検索語・大分類・詳しい種類を組み合わせて絞り込む", async () => {
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "appliance",
      kindCode: "asset",
      name: "リビングの冷蔵庫",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "appliance",
      kindCode: "asset",
      name: "キッチンの冷蔵庫",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    const combined = await listManagedItems(db, householdAMember, {
      itemTypeCode: "appliance",
      kindCode: "asset",
      search: "リビング",
    });
    expect(combined.map(({ name }) => name)).toEqual(["リビングの冷蔵庫"]);
  });

  it("別家庭の管理対象は検索結果へ混ざらない", async () => {
    await createManagedItem(db, householdBMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "other",
      kindCode: "other",
      name: "共通のキーワード用B",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "other",
      kindCode: "other",
      name: "共通のキーワード用A",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    const filtered = await listManagedItems(db, householdAMember, { search: "共通のキーワード" });
    expect(filtered.map(({ name }) => name)).toEqual(["共通のキーワード用A"]);
  });
});

describe("D1 台帳一覧の自由入力(詳しい種類)候補・絞り込み認可 (Issue #238)", () => {
  it("自由入力(customItemType)で絞り込み、プリセットの詳しい種類とは独立して一致する", async () => {
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "appliance",
      kindCode: "asset",
      name: "冷蔵庫",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    await createManagedItem(db, householdAMember, {
      customItemType: "特注の棚",
      externalUrl: null,
      itemTypeCode: null,
      kindCode: "asset",
      name: "オーダー家具",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    const filtered = await listManagedItems(db, householdAMember, { customItemType: "特注の棚" });
    expect(filtered.map(({ name }) => name)).toEqual(["オーダー家具"]);
  });

  it("自由入力の表記の大文字小文字・前後の空白を無視して一致させる", async () => {
    await createManagedItem(db, householdAMember, {
      customItemType: "IoTセンサー",
      externalUrl: null,
      itemTypeCode: null,
      kindCode: "asset",
      name: "センサーA",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    await createManagedItem(db, householdAMember, {
      customItemType: "iotセンサー",
      externalUrl: null,
      itemTypeCode: null,
      kindCode: "asset",
      name: "センサーB",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    const filtered = await listManagedItems(db, householdAMember, { customItemType: "  IOTセンサー  " });
    expect(filtered.map(({ name }) => name).sort()).toEqual(["センサーA", "センサーB"]);
  });

  it("別家庭の自由入力値は絞り込み結果に混ざらない", async () => {
    await createManagedItem(db, householdBMember, {
      customItemType: "共通ワード",
      externalUrl: null,
      itemTypeCode: null,
      kindCode: "asset",
      name: "B専用棚",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    await createManagedItem(db, householdAMember, {
      customItemType: "共通ワード",
      externalUrl: null,
      itemTypeCode: null,
      kindCode: "asset",
      name: "A専用棚",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    const filtered = await listManagedItems(db, householdAMember, { customItemType: "共通ワード" });
    expect(filtered.map(({ name }) => name)).toEqual(["A専用棚"]);
  });

  it("家庭内で使われている自由入力の詳しい種類を大分類ごとに重複なく候補として返す", async () => {
    await createManagedItem(db, householdAMember, {
      customItemType: "IoTセンサー",
      externalUrl: null,
      itemTypeCode: null,
      kindCode: "asset",
      name: "センサーA",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    // 大文字小文字だけが違う表記は1件へまとめる。SQLiteのMIN()はASCIIコード順で
    // 比較するため、"IoTセンサー"("I"=0x49)が"iotセンサー"("i"=0x69)より小さく、
    // 代表表記として選ばれる。
    await createManagedItem(db, householdAMember, {
      customItemType: "iotセンサー",
      externalUrl: null,
      itemTypeCode: null,
      kindCode: "asset",
      name: "センサーB",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    await expect(listHouseholdCustomItemTypes(db, householdAMember)).resolves.toEqual([
      { kindCode: "asset", label: "IoTセンサー" },
    ]);
  });

  it("プリセットの詳しい種類だけの家庭では自由入力候補を返さない", async () => {
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "appliance",
      kindCode: "asset",
      name: "冷蔵庫",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    await expect(listHouseholdCustomItemTypes(db, householdAMember)).resolves.toEqual([]);
  });

  it("他家庭の自由入力値は候補に混ざらない", async () => {
    await createManagedItem(db, householdBMember, {
      customItemType: "B専用種別",
      externalUrl: null,
      itemTypeCode: null,
      kindCode: "other",
      name: "B専用の対象",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    await createManagedItem(db, householdAMember, {
      customItemType: "A専用種別",
      externalUrl: null,
      itemTypeCode: null,
      kindCode: "other",
      name: "A専用の対象",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    await expect(listHouseholdCustomItemTypes(db, householdAMember)).resolves.toEqual([
      { kindCode: "other", label: "A専用種別" },
    ]);
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
      scheduleMonthEnd: false,
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

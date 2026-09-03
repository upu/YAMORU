import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyAllMigrations } from "./test-support/migrations";
import {
  createManagedItem,
  getManagedItemForEdit,
  listManagedItemClassificationOptions,
  updateManagedItem,
} from "./managed-items";
import { createCalendarTask, createOneTimeTask } from "./todos";

const db = env.DB;
const householdMember = { email: "a@example.com", userId: "user-a" };

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM activity_logs"),
    db.prepare("DELETE FROM task_occurrences"),
    db.prepare("DELETE FROM task_rules"),
    db.prepare("DELETE FROM external_links"),
    db.prepare("DELETE FROM managed_items"),
    db.prepare("DELETE FROM household_members"),
    db.prepare("DELETE FROM households"),
    db.prepare("DELETE FROM users"),
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')"),
    db.prepare("INSERT INTO managed_items (id, household_id, name, kind) VALUES ('item-a', 'household-a', 'Existing item', 'other')"),
    db.prepare("INSERT INTO managed_item_classifications (managed_item_id, household_id, kind_code, item_type_code) VALUES ('item-a', 'household-a', 'other', 'other')"),
    db.prepare("INSERT INTO external_links (id, household_id, managed_item_id, url) VALUES ('link-a', 'household-a', 'item-a', 'https://example.com/existing')"),
    db.prepare("INSERT INTO task_rules (id, household_id, managed_item_id, title, recurrence_basis, deadline_kind) VALUES ('rule-a', 'household-a', 'item-a', 'Existing todo', 'once', 'strict')"),
    db.prepare("INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at, status) VALUES ('occurrence-a', 'household-a', 'rule-a', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z', 'completed')"),
    db.prepare("INSERT INTO activity_logs (id, household_id, task_occurrence_id, action, actor_user_id, performed_by_user_id, occurred_at, idempotency_key) VALUES ('log-a', 'household-a', 'occurrence-a', 'completed', 'user-a', 'user-a', '2026-08-24T00:00:00.000Z', 'existing-completion')"),
  ]);
});

describe("固定資産税の台帳分類(Issue #177)", () => {
  it("新規登録と編集でサービス・契約/固定資産税を保存し、既存関連データを保持する", async () => {
    await expect(listManagedItemClassificationOptions(db)).resolves.toMatchObject({
      itemTypes: expect.arrayContaining([
        { code: "property_tax", kindCode: "service", label: "固定資産税" },
      ]),
    });

    const newItemId = await createManagedItem(db, householdMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "property_tax",
      kindCode: "service",
      name: "2026年度 固定資産税",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    await expect(getManagedItemForEdit(db, householdMember, newItemId)).resolves.toMatchObject({
      itemTypeCode: "property_tax",
      itemTypeLabel: "固定資産税",
      kindCode: "service",
      kindLabel: "サービス・契約",
    });

    await updateManagedItem(db, householdMember, "item-a", {
      customItemType: null,
      externalUrl: "https://example.com/existing",
      itemTypeCode: "property_tax",
      kindCode: "service",
      name: "既存の固定資産税",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    await expect(db.prepare(
      "SELECT url FROM external_links WHERE managed_item_id = 'item-a'",
    ).first()).resolves.toMatchObject({ url: "https://example.com/existing" });
    await expect(db.prepare(
      "SELECT managed_item_id FROM task_rules WHERE id = 'rule-a'",
    ).first()).resolves.toMatchObject({ managed_item_id: "item-a" });
    await expect(db.prepare(
      "SELECT task_rule_id FROM task_occurrences WHERE id = 'occurrence-a'",
    ).first()).resolves.toMatchObject({ task_rule_id: "rule-a" });
    await expect(db.prepare(
      "SELECT task_occurrence_id FROM activity_logs WHERE id = 'log-a'",
    ).first()).resolves.toMatchObject({ task_occurrence_id: "occurrence-a" });
  });

  it("固定資産税へ一回限りと毎年の納期限Todoをひも付ける", async () => {
    const itemId = await createManagedItem(db, householdMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "property_tax",
      kindCode: "service",
      name: "固定資産税",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    await createOneTimeTask(db, householdMember, {
      managedItemId: itemId,
      scheduledFor: "2026-09-30T15:00:00.000Z",
      title: "固定資産税 第2期の納付確認",
    });
    await createCalendarTask(db, householdMember, {
      managedItemId: itemId,
      scheduleDayOfMonth: 31,
      scheduleDaysOfWeek: [],
      scheduleKind: "yearly",
      scheduleMonth: 5,
      scheduleMonthEnd: false,
      scheduleWeekOfMonth: null,
      title: "固定資産税の納期限確認",
    }, new Date("2026-08-24T00:00:00.000Z"));

    const rules = await db.prepare(
      "SELECT recurrence_basis, schedule_kind, schedule_month, schedule_day_of_month FROM task_rules WHERE managed_item_id = ?1 ORDER BY recurrence_basis",
    ).bind(itemId).all();
    expect(rules.results).toEqual([
      {
        recurrence_basis: "calendar",
        schedule_day_of_month: 31,
        schedule_kind: "yearly",
        schedule_month: 5,
      },
      {
        recurrence_basis: "once",
        schedule_day_of_month: null,
        schedule_kind: null,
        schedule_month: null,
      },
    ]);
  });
});

import { describe, expect, it } from "vitest";

import {
  assertMigrationTargetSchema,
  buildMigrationPlan,
  parseDataMigrationInvocation,
  summarizeMigrationPlan,
  type SourceDataDump,
  type TargetSnapshot,
} from "../scripts/data-migration-contract";

const sourceUserId = "11111111-1111-4111-8111-111111111111";
const targetUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const householdId = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";
const ruleId = "44444444-4444-4444-8444-444444444444";
const occurrenceId = "55555555-5555-4555-8555-555555555555";

function sourceDump(): SourceDataDump {
  return {
    users: [{
      id: sourceUserId,
      email: " Owner@Example.Test ",
      created_at: "2026-08-01T00:00:00.000Z",
    }],
    households: [{
      id: householdId,
      name: "わが家",
      created_at: "2026-08-01T00:01:00.000Z",
    }],
    household_members: [{
      id: "member-source-id",
      household_id: householdId,
      user_id: sourceUserId,
      created_at: "2026-08-01T00:02:00.000Z",
    }],
    profiles: [{
      user_id: sourceUserId,
      nickname: "オーナー",
      created_at: "2026-08-01T00:03:00.000Z",
    }],
    managed_items: [{
      id: itemId,
      household_id: householdId,
      name: "フィルター",
      kind: "pet_supplies",
      created_at: "2026-08-01T00:04:00.000Z",
    }],
    external_links: [],
    task_rules: [{
      id: ruleId,
      household_id: householdId,
      managed_item_id: itemId,
      title: "交換する",
      recurrence_basis: "completion",
      deadline_kind: "maintenance",
      unresolved_policy: "carry_over",
      recommended_start_offset: 25,
      recommended_until_offset: 30,
      schedule_kind: null,
      schedule_day_of_week: null,
      schedule_day_of_month: null,
      schedule_week_of_month: null,
      schedule_month: null,
      created_at: "2026-08-01T00:05:00.000Z",
    }],
    task_occurrences: [{
      id: occurrenceId,
      household_id: householdId,
      task_rule_id: ruleId,
      scheduled_for: "2026-08-20T00:00:00.000Z",
      due_at: "2026-08-25T00:00:00.000Z",
      assignee_user_id: sourceUserId,
      status: "pending",
      created_at: "2026-08-01T00:06:00.000Z",
    }],
    activity_logs: [{
      id: "66666666-6666-4666-8666-666666666666",
      household_id: householdId,
      task_occurrence_id: occurrenceId,
      action: "postponed",
      actor_user_id: sourceUserId,
      performed_by_user_id: null,
      occurred_at: "2026-08-10T00:00:00.000Z",
      recorded_at: "2026-08-10T00:00:01.000Z",
      idempotency_key: null,
      next_task_occurrence_id: null,
      previous_due_at: "2026-08-20T00:00:00.000Z",
      new_due_at: "2026-08-25T00:00:00.000Z",
      previous_assignee_user_id: null,
      new_assignee_user_id: null,
    }],
    household_invitations: [],
    invitation_claims: [],
  };
}

function emptyTarget(users: TargetSnapshot["users"] = []): TargetSnapshot {
  return {
    users,
    counts: {
      households: 0,
      household_members: 0,
      profiles: 0,
      managed_items: 0,
      external_links: 0,
      task_rules: 0,
      task_occurrences: 0,
      activity_logs: 0,
      household_invitations: 0,
      invitation_claims: 0,
    },
  };
}

describe("SupabaseからD1への一回限りのデータ移行", () => {
  it("既存Auth.js利用者を正規化emailで対応付け、すべての利用者参照を付け替える", () => {
    const plan = buildMigrationPlan(
      sourceDump(),
      emptyTarget([{
        id: targetUserId,
        email: "owner@example.test",
        password_hash_present: true,
        created_at: "2026-08-20T00:00:00.000Z",
      }]),
    );

    expect(plan.users).toEqual([]);
    expect(plan.userIdMap.get(sourceUserId)).toBe(targetUserId);
    expect(plan.household_members[0]).toMatchObject({ user_id: targetUserId });
    expect(plan.profiles[0]).toMatchObject({ user_id: targetUserId });
    expect(plan.task_occurrences[0]).toMatchObject({ assignee_user_id: targetUserId });
    expect(plan.activity_logs[0]).toMatchObject({ actor_user_id: targetUserId });
  });

  it("対応するAuth.js利用者がなければ同じIDで無効アカウントを作り、パスワードは移行しない", () => {
    const plan = buildMigrationPlan(sourceDump(), emptyTarget());

    expect(plan.users).toEqual([{
      id: sourceUserId,
      email: "owner@example.test",
      password_hash: null,
      session_version: 0,
      created_at: "2026-08-01T00:00:00.000Z",
    }]);
  });

  it("主キー、日時、延期履歴、移行元membership IDを保持する", () => {
    const plan = buildMigrationPlan(sourceDump(), emptyTarget());

    expect(plan.households[0]?.id).toBe(householdId);
    expect(plan.household_members[0]?.source_id).toBe("member-source-id");
    expect(plan.task_occurrences[0]).toMatchObject({
      id: occurrenceId,
      scheduled_for: "2026-08-20T00:00:00.000Z",
      due_at: "2026-08-25T00:00:00.000Z",
    });
    expect(plan.activity_logs[0]).toMatchObject({
      previous_due_at: "2026-08-20T00:00:00.000Z",
      new_due_at: "2026-08-25T00:00:00.000Z",
    });
  });

  it("PostgreSQLのUTC offsetをD1で比較可能なZ表記へ統一する", () => {
    const source = sourceDump();
    source.task_occurrences[0].due_at = "2026-08-25T00:00:00.123456+00:00";

    const plan = buildMigrationPlan(source, emptyTarget());

    expect(plan.task_occurrences[0]?.due_at).toBe("2026-08-25T00:00:00.123456Z");
  });

  it("dry runの要約は件数と対応状況だけを返し、実データ値を含めない", () => {
    const summary = summarizeMigrationPlan(buildMigrationPlan(sourceDump(), emptyTarget()));

    expect(summary).toMatchObject({
      sourceUsers: 1,
      matchedUsers: 0,
      importedUsersWithoutPassword: 1,
      households: 1,
      managedItems: 1,
      taskOccurrences: 1,
      activityLogs: 1,
    });
    expect(JSON.stringify(summary)).not.toContain("Owner@Example.Test");
    expect(JSON.stringify(summary)).not.toContain("わが家");
  });

  it("production D1に既存の家庭データがあれば上書きせず拒否する", () => {
    const target = emptyTarget();
    target.counts.households = 1;

    expect(() => buildMigrationPlan(sourceDump(), target)).toThrow(/空/u);
  });

  it("production D1に移行専用schemaが未適用なら拒否する", () => {
    expect(() => {
      assertMigrationTargetSchema({
        household_members: [],
        activity_logs: ["previous_due_at"],
        household_invitations: ["replaced_by_invitation_id"],
      });
    }).toThrow(/0003/u);
  });

  it("壊れた家庭参照をdry runで拒否する", () => {
    const source = sourceDump();
    source.managed_items[0].household_id = "other-household";

    expect(() => buildMigrationPlan(source, emptyTarget())).toThrow(/managed_items/u);
  });

  it("dry-runとapplyだけを受け付け、production対象名の確認を必須にする", () => {
    expect(parseDataMigrationInvocation(["dry-run", "--environment", "production"])).toEqual({
      command: "dry-run",
      environment: "production",
    });
    expect(parseDataMigrationInvocation(["apply", "--environment", "production"])).toEqual({
      command: "apply",
      environment: "production",
    });
    expect(() => parseDataMigrationInvocation(["apply"])).toThrow();
    expect(() => parseDataMigrationInvocation(["apply", "--environment", "preview"])).toThrow();
    expect(() => parseDataMigrationInvocation(["apply", "--environment", "production", "secret"])).toThrow();
  });
});

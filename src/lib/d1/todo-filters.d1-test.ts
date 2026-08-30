import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  listPendingOccurrences,
  listRecentActiveCompletions,
} from "./home";
import {
  completeTask,
  createOneTimeTask,
  setTaskOccurrenceAssignee,
  undoTaskCompletion,
} from "./todos";
import {
  householdAMember,
  householdBMember,
  occurrenceForRule,
  resetHouseholdFixtures,
} from "./test-support/households";
import { applyAllMigrations } from "./test-support/migrations";

// Todo一覧の絞り込み(実施済み・担当予定者・Todo名検索)が、家庭の境界を
// 越えないこと。

const db = env.DB;

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await resetHouseholdFixtures(db);
});

describe("D1 recent completions authorization (Issue #222)", () => {
  it("実施済みの取得は所属家庭のOccurrenceだけに限る", async () => {
    const aRuleId = await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-08-01T15:00:00.000Z",
      title: "A task",
    });
    const aOccurrence = await occurrenceForRule(db, aRuleId);
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
    const bOccurrence = await occurrenceForRule(db, bRuleId);
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
    const occurrence = await occurrenceForRule(db, ruleId);
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
    const unassignedOccurrence = await occurrenceForRule(db, unassignedRuleId);

    const selfRuleId = await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-08-01T15:00:00.000Z",
      title: "Self task",
    });
    const selfOccurrence = await occurrenceForRule(db, selfRuleId);
    await setTaskOccurrenceAssignee(db, householdAMember, selfOccurrence.id, "user-a");

    const otherRuleId = await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-08-01T15:00:00.000Z",
      title: "Other member task",
    });
    const otherOccurrence = await occurrenceForRule(db, otherRuleId);
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
    const bOccurrence = await occurrenceForRule(db, bRuleId);
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
    const assignedOccurrence = await occurrenceForRule(db, assignedRuleId);
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
    const unassignedOccurrence = await occurrenceForRule(db, unassignedRuleId);
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
    const matchOccurrence = await occurrenceForRule(db, matchRuleId);
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
    const occurrence = await occurrenceForRule(db, ruleId);

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
    const wildcardOccurrence = await occurrenceForRule(db, wildcardRuleId);
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
    const matchOccurrence = await occurrenceForRule(db, matchRuleId);
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
    const otherOccurrence = await occurrenceForRule(db, otherRuleId);
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

import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { IntegrationPrincipal } from "../../features/integration/principal";
import { householdAMember, resetHouseholdFixtures } from "./test-support/households";
import {
  addFamilyMember,
  commandService,
  connectPrincipal,
  countRows,
  createEverySaturdayTodo,
  expectCommandError,
  familyMember,
  interruptBeforeBatch,
} from "./test-support/integration-commands";
import { readHistoryRows } from "./conversation-read";
import { applyAllMigrations } from "./test-support/migrations";
import { updateOneTimeTodo, updateRecurringTaskRule } from "./todos";

// 外部command todo.update(#437)を実D1で確かめる。繰り返し方式ごとのedit_scope、
// 指定した項目だけを変えること、Webの編集と同じ保存形、競合・途中失敗で
// 何も変えないことを検証する。
const db = env.DB;
const memberA = { householdId: "household-a", userId: householdAMember.userId };

type Prepared = { fingerprint: string; operation_id: string; preview_id: string } & Record<string, unknown>;
type Service = ReturnType<typeof commandService>;

let principal: IntegrationPrincipal;

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await resetHouseholdFixtures(db);
  await addFamilyMember(db);
  principal = await connectPrincipal(db, memberA);
});

function updateRequest(occurrenceId: string, payload: Record<string, unknown>) {
  return { command: "todo.update", operation_id: crypto.randomUUID(), payload, target: { id: occurrenceId, kind: "todo_occurrence" } };
}

function commitRequest(prepared: Prepared) {
  return { fingerprint: prepared.fingerprint, operation_id: prepared.operation_id, preview_id: prepared.preview_id };
}

async function prepare(service: Service, body: unknown): Promise<Prepared> {
  return await service.prepare(principal, body) as Prepared;
}

async function run(service: Service, body: unknown): Promise<{ result: Record<string, unknown> }> {
  const prepared = await prepare(service, body);
  return await service.commit(principal, commitRequest(prepared)) as { result: Record<string, unknown> };
}

async function createTodo(recurrence: Record<string, unknown>, title = "点検"): Promise<string> {
  const committed = await run(commandService(db), { command: "todo.create", operation_id: crypto.randomUUID(), payload: { recurrence, title } });
  return (committed.result.first_occurrence as { id: string }).id;
}

async function todoState(occurrenceId: string): Promise<Record<string, unknown> | null> {
  return db.prepare(`SELECT r.title, r.note, r.managed_item_id, o.assignee_user_id, o.scheduled_for, o.due_at, o.must_complete_by
      FROM task_occurrences o JOIN task_rules r ON r.id = o.task_rule_id WHERE o.id = ?1`).bind(occurrenceId).first();
}

const RULE_COLUMNS = `title, note, managed_item_id, schedule_kind, schedule_day_of_week, schedule_day_of_month,
  schedule_week_of_month, schedule_month, schedule_month_end,
  (SELECT group_concat(day_of_week) FROM task_rule_schedules s WHERE s.task_rule_id = r.id) AS specs`;

async function ruleOf(occurrenceId: string): Promise<unknown> {
  return db.prepare(`SELECT ${RULE_COLUMNS} FROM task_rules r WHERE r.id = (SELECT task_rule_id FROM task_occurrences WHERE id = ?1)`)
    .bind(occurrenceId).first();
}

describe("暦を持つ繰り返し", () => {
  it("今回分は、担当だけを変えても期限を確かめ直さない", async () => {
    // 10月10日(土)の回は期限を過ぎているが、担当だけの変更は拒否しない。
    const occurrenceId = await createEverySaturdayTodo(db);
    const committed = await run(commandService(db), updateRequest(occurrenceId, {
      changes: { assignee_id: familyMember.userId }, edit_scope: "current_occurrence",
    }));
    expect(committed.result).toMatchObject({ due_on: "2026-10-10", edit_scope: "current_occurrence" });
    await expect(todoState(occurrenceId)).resolves.toMatchObject({
      assignee_user_id: familyMember.userId, due_at: "2026-10-09T15:00:00.000Z",
    });
    await expect(countRows(db, "SELECT count(*) AS count FROM activity_logs WHERE task_occurrence_id = ?1 AND action = 'assignee_changed'", occurrenceId))
      .resolves.toBe(1);
  });

  it("今回分の期限と必達日を一度に変え、本来の予定日は保つ", async () => {
    const occurrenceId = await createEverySaturdayTodo(db);
    const service = commandService(db);
    const prepared = await prepare(service, updateRequest(occurrenceId, {
      changes: { due_on: "2026-10-14", must_complete_by: "2026-10-20" }, edit_scope: "current_occurrence",
    }));
    expect(prepared).toMatchObject({
      diff: { due_on: { from: "2026-10-10", to: "2026-10-14" }, must_complete_by: { from: null, to: "2026-10-20" } },
      schedule_effect: { applies_to: "current_occurrence", current_occurrence: { due_on: "2026-10-14", scheduled_on: "2026-10-10" } },
    });
    const first = await service.commit(principal, commitRequest(prepared));
    await expect(service.commit(principal, commitRequest(prepared))).resolves.toEqual({ ...first, replayed: true });
    await expect(todoState(occurrenceId)).resolves.toMatchObject({
      due_at: "2026-10-13T15:00:00.000Z", must_complete_by: "2026-10-20", scheduled_for: "2026-10-09T15:00:00.000Z",
    });
    await expect(countRows(db, "SELECT count(*) AS count FROM task_deadline_changes WHERE task_occurrence_id = ?1", occurrenceId))
      .resolves.toBe(1);
  });

  it("次回以降の条件をWebの編集と同じ保存形で変え、次回の予定に反映する", async () => {
    const commandTodo = await createEverySaturdayTodo(db);
    const webTodo = await createEverySaturdayTodo(db);
    const service = commandService(db);
    const prepared = await prepare(service, updateRequest(commandTodo, {
      changes: { recurrence: { days_of_week: [7], kind: "weekly", type: "calendar" }, title: "資源ごみ" },
      edit_scope: "future_rule",
    }));
    expect(prepared).toMatchObject({
      diff: { title: { from: "ごみ出し", to: "資源ごみ" } },
      schedule_effect: { applies_to: "future_occurrences", current_occurrence: { scheduled_on: "2026-10-10" } },
    });
    await service.commit(principal, commitRequest(prepared));
    await updateRecurringTaskRule(db, householdAMember, webTodo, {
      managedItemId: null,
      note: null,
      recurrenceBasis: "calendar",
      scheduleDayOfMonth: null,
      scheduleDaysOfWeek: [7],
      scheduleKind: "weekly",
      scheduleMonth: null,
      scheduleMonthEnd: false,
      scheduleWeekOfMonth: null,
      title: "資源ごみ",
    });
    await expect(ruleOf(commandTodo)).resolves.toEqual(await ruleOf(webTodo));
    // 今回分の予定は変えず、完了すると次回は日曜になる。
    await expect(todoState(commandTodo)).resolves.toMatchObject({ scheduled_for: "2026-10-09T15:00:00.000Z" });
    await expect(prepare(service, {
      command: "todo.complete", operation_id: crypto.randomUUID(), payload: { occurred_on: "2026-10-12" },
      target: { id: commandTodo, kind: "todo_occurrence" },
    })).resolves.toMatchObject({ schedule_effect: { next_occurrence: { scheduled_on: "2026-10-18" } } });
  });

  it("名前だけの変更は繰り返し条件に触れない", async () => {
    const occurrenceId = await createEverySaturdayTodo(db);
    const before = await ruleOf(occurrenceId) as Record<string, unknown>;
    await run(commandService(db), updateRequest(occurrenceId, { changes: { note: "朝8時まで" }, edit_scope: "future_rule" }));
    await expect(ruleOf(occurrenceId)).resolves.toEqual({ ...before, note: "朝8時まで" });
  });

  it("方式の変更や、方式に合わないedit_scopeを拒否する", async () => {
    const service = commandService(db);
    const occurrenceId = await createEverySaturdayTodo(db);
    const basis = await expectCommandError(service.prepare(principal, updateRequest(occurrenceId, {
      changes: { recurrence: { count: 1, start_on: "2026-10-12", type: "interval", unit: "week" } }, edit_scope: "future_rule",
    })), "invalid_input");
    expect(basis.fieldErrors).toEqual({ "payload.changes.recurrence.type": "recurrence_basis_immutable" });
    const scope = await expectCommandError(service.prepare(principal, updateRequest(occurrenceId, {
      edit_scope: "one_time_combined", rule_changes: { title: "x" },
    })), "invalid_input");
    expect(scope.fieldErrors).toEqual({ "payload.edit_scope": "not_for_calendar" });
    const past = await expectCommandError(service.prepare(principal, updateRequest(occurrenceId, {
      changes: { due_on: "2026-10-11" }, edit_scope: "current_occurrence",
    })), "invalid_input");
    expect(past.fieldErrors).toEqual({ "payload.changes.due_on": "must_be_after_today" });
    const empty = await expectCommandError(service.prepare(principal, updateRequest(occurrenceId, {
      changes: {}, edit_scope: "current_occurrence",
    })), "missing_required");
    expect(empty.fieldErrors).toEqual({ "payload.changes": "at_least_one_change" });
  });
});

describe("履歴の接続元", () => {
  it("担当・期限の変更履歴に、外部commandの接続元を残す", async () => {
    const recurring = await createEverySaturdayTodo(db);
    await run(commandService(db), updateRequest(recurring, {
      changes: { assignee_id: familyMember.userId, due_on: "2026-10-14" }, edit_scope: "current_occurrence",
    }));
    const oneTime = await createTodo({ scheduled_on: "2026-10-20", type: "one_time" });
    await run(commandService(db), updateRequest(oneTime, {
      edit_scope: "one_time_combined", occurrence_changes: { assignee_id: familyMember.userId },
    }));
    const clients = async (occurrenceId: string) => (await readHistoryRows(db, "household-a", "todo_occurrence", occurrenceId, "", 20))
      .filter((row) => row.kind === "assignee_changed" || row.kind === "postponed")
      .map((row) => [row.kind, row.client_id]).sort();
    await expect(clients(recurring)).resolves.toEqual([["assignee_changed", principal.clientId], ["postponed", principal.clientId]]);
    await expect(clients(oneTime)).resolves.toEqual([["assignee_changed", principal.clientId]]);
  });

  it("繰り返し条件・必達日の変更履歴にも、外部commandの接続元を残す", async () => {
    const recurring = await createEverySaturdayTodo(db);
    await run(commandService(db), updateRequest(recurring, { changes: { title: "資源ごみ" }, edit_scope: "future_rule" }));
    await run(commandService(db), updateRequest(recurring, { changes: { must_complete_by: "2026-10-20" }, edit_scope: "current_occurrence" }));
    const manual = await createTodo({ type: "manual" }, "電池交換");
    await run(commandService(db), updateRequest(manual, { edit_scope: "manual_combined", rule_changes: { title: "電池の交換" } }));
    const clients = async (occurrenceId: string) => (await readHistoryRows(db, "household-a", "todo_occurrence", occurrenceId, "", 20))
      .filter((row) => row.kind === "rule_changed" || row.kind === "hard_deadline_changed")
      .map((row) => [row.kind, row.client_id]).sort();
    await expect(clients(recurring)).resolves.toEqual([["hard_deadline_changed", principal.clientId], ["rule_changed", principal.clientId]]);
    await expect(clients(manual)).resolves.toEqual([["rule_changed", principal.clientId]]);
  });
});

describe("一回限り・必要時", () => {
  it("一回限りの名前・担当・予定日を一度に変える", async () => {
    const occurrenceId = await createTodo({ scheduled_on: "2026-10-20", type: "one_time" }, "粗大ごみの申込み");
    const committed = await run(commandService(db), updateRequest(occurrenceId, {
      edit_scope: "one_time_combined",
      occurrence_changes: { assignee_id: familyMember.userId, scheduled_on: "2026-10-22" },
      rule_changes: { title: "粗大ごみの予約" },
    }));
    expect(committed.result).toMatchObject({ due_on: "2026-10-22", scheduled_on: "2026-10-22" });
    await expect(todoState(occurrenceId)).resolves.toMatchObject({
      assignee_user_id: familyMember.userId,
      due_at: "2026-10-21T15:00:00.000Z",
      scheduled_for: "2026-10-21T15:00:00.000Z",
      title: "粗大ごみの予約",
    });
  });

  it("Webの一回限りの編集と同じ保存形にする", async () => {
    const commandTodo = await createTodo({ scheduled_on: "2026-10-20", type: "one_time" });
    const webTodo = await createTodo({ scheduled_on: "2026-10-20", type: "one_time" });
    await run(commandService(db), updateRequest(commandTodo, {
      edit_scope: "one_time_combined", occurrence_changes: { scheduled_on: null }, rule_changes: { managed_item_id: "item-a", note: "電話で" },
    }));
    await updateOneTimeTodo(db, householdAMember, webTodo, {
      assigneeUserId: null, managedItemId: "item-a", note: "電話で", scheduledFor: null, title: "点検",
    });
    await expect(todoState(commandTodo)).resolves.toEqual(await todoState(webTodo));
  });

  it("途中で失敗すれば、名前・担当・予定日のどれも変えない", async () => {
    const occurrenceId = await createTodo({ scheduled_on: "2026-10-20", type: "one_time" }, "粗大ごみの申込み");
    const before = await todoState(occurrenceId);
    const prepared = await prepare(commandService(db), updateRequest(occurrenceId, {
      edit_scope: "one_time_combined",
      occurrence_changes: { assignee_id: familyMember.userId, scheduled_on: "2026-10-22" },
      rule_changes: { title: "粗大ごみの予約" },
    }));
    // 担当にした家族が、確認の後に家庭を離れる。世代は進まないためbatchまで
    // 進み、担当の外部キーでbatch全体が取り消される。
    const leaving = interruptBeforeBatch(db, async () => {
      await db.prepare("DELETE FROM household_members WHERE user_id = ?1").bind(familyMember.userId).run();
    });
    const error = await expectCommandError(commandService(leaving).commit(principal, commitRequest(prepared)), "invalid_input");
    expect(error.fieldErrors).toEqual({ "payload.occurrence_changes.assignee_id": "not_in_household" });
    await expect(todoState(occurrenceId)).resolves.toEqual(before);
  });

  it("確認の後に家族が編集すれば、どれも変えない", async () => {
    const occurrenceId = await createTodo({ scheduled_on: "2026-10-20", type: "one_time" }, "粗大ごみの申込み");
    const prepared = await prepare(commandService(db), updateRequest(occurrenceId, {
      edit_scope: "one_time_combined",
      occurrence_changes: { assignee_id: familyMember.userId, scheduled_on: "2026-10-22" },
      rule_changes: { title: "粗大ごみの予約" },
    }));
    await updateOneTimeTodo(db, familyMember, occurrenceId, {
      assigneeUserId: null, managedItemId: null, note: "家族のメモ", scheduledFor: "2026-10-19T15:00:00.000Z", title: "粗大ごみの申込み",
    });
    const changed = await todoState(occurrenceId);
    await expectCommandError(commandService(db).commit(principal, commitRequest(prepared)), "stale_preview");
    await expect(todoState(occurrenceId)).resolves.toEqual(changed);
  });

  it("必要時のTodoは名前と担当を変え、予定日は受け付けない", async () => {
    const service = commandService(db);
    const occurrenceId = await createTodo({ type: "manual" }, "電池交換");
    await run(service, updateRequest(occurrenceId, {
      edit_scope: "manual_combined", occurrence_changes: { assignee_id: familyMember.userId }, rule_changes: { title: "電池の交換" },
    }));
    await expect(todoState(occurrenceId)).resolves.toMatchObject({
      assignee_user_id: familyMember.userId, scheduled_for: null, title: "電池の交換",
    });
    const dated = await expectCommandError(service.prepare(principal, updateRequest(occurrenceId, {
      edit_scope: "manual_combined", occurrence_changes: { scheduled_on: "2026-10-20" },
    })), "invalid_input");
    expect(dated.fieldErrors).toEqual({ "payload.occurrence_changes.scheduled_on": "unknown_field" });
  });
});

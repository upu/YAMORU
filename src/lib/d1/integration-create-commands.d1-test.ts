import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { IntegrationPrincipal } from "../../features/integration/principal";
import { householdAMember, resetHouseholdFixtures } from "./test-support/households";
import {
  addFamilyMember,
  commandService,
  connectPrincipal,
  countRows,
  expectCommandError,
  familyMember,
  interruptBeforeBatch,
  MONDAY_NOON,
  testClock,
} from "./test-support/integration-commands";
import { applyAllMigrations } from "./test-support/migrations";
import { createCalendarTask } from "./todos";

// 外部command todo.create(#437)を実D1で確かめる。Webの登録と同じ規則・同じ
// 保存形で作ること、方式ごとの次回の決まり方をpreviewで区別できること、
// 再送で二重に作らないこと、確認後の変化で作らないことを検証する。
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

function createRequest(payload: Record<string, unknown>, operationId = crypto.randomUUID()) {
  return { command: "todo.create", operation_id: operationId, payload };
}

function commitRequest(prepared: Prepared) {
  return { fingerprint: prepared.fingerprint, operation_id: prepared.operation_id, preview_id: prepared.preview_id };
}

async function prepare(service: Service, request: unknown): Promise<Prepared> {
  return await service.prepare(principal, request) as Prepared;
}

async function run(service: Service, payload: Record<string, unknown>) {
  const prepared = await prepare(service, createRequest(payload));
  return service.commit(principal, commitRequest(prepared)) as Promise<{ result: { first_occurrence: { id: string } } }>;
}

const EVERY_SATURDAY = { days_of_week: [6], kind: "weekly", type: "calendar" };
const SEVEN_DAYS_AFTER = { first_scheduled_on: "2026-10-17", max: 7, min: 7, type: "completion", unit: "day" };

async function scheduledOn(occurrenceId: string): Promise<unknown> {
  return db.prepare("SELECT scheduled_for, due_at FROM task_occurrences WHERE id = ?1").bind(occurrenceId).first();
}

describe("todo.create", () => {
  it("毎週土曜と実施から7日後を、previewの次回の決まり方で区別する", async () => {
    const service = commandService(db);
    await expect(prepare(service, createRequest({ recurrence: EVERY_SATURDAY, title: "ごみ出し" }))).resolves.toMatchObject({
      schedule_effect: {
        first_occurrence: { scheduled_on: "2026-10-17" },
        following_occurrence: { scheduled_on: "2026-10-24" },
        next_after_completion: null,
        recurrence: "calendar",
      },
    });
    await expect(prepare(service, createRequest({ recurrence: SEVEN_DAYS_AFTER, title: "フィルター掃除" }))).resolves.toMatchObject({
      schedule_effect: {
        first_occurrence: { due_on: "2026-10-17", scheduled_on: "2026-10-17" },
        following_occurrence: null,
        next_after_completion: { max: 7, min: 7, unit: "day" },
        recurrence: "completion",
      },
    });
  });

  it("登録した2つを同じ月曜に完了すると、次回は土曜と7日後に分かれる", async () => {
    const clock = testClock();
    const service = commandService(db, clock);
    const saturday = await run(service, { recurrence: EVERY_SATURDAY, title: "ごみ出し" });
    const sevenDays = await run(service, { recurrence: SEVEN_DAYS_AFTER, title: "フィルター掃除" });
    clock.advance(7 * 24 * 60 * 60 * 1000);

    const complete = async (occurrenceId: string) => {
      const prepared = await prepare(service, {
        command: "todo.complete",
        operation_id: crypto.randomUUID(),
        payload: { occurred_on: "2026-10-19" },
        target: { id: occurrenceId, kind: "todo_occurrence" },
      });
      return prepared.schedule_effect as { next_occurrence: { scheduled_on: string } };
    };
    await expect(complete(saturday.result.first_occurrence.id)).resolves.toMatchObject({ next_occurrence: { scheduled_on: "2026-10-24" } });
    await expect(complete(sevenDays.result.first_occurrence.id)).resolves.toMatchObject({ next_occurrence: { scheduled_on: "2026-10-26" } });
  });

  it("Webの登録と同じ保存形で作る", async () => {
    const committed = await run(commandService(db), { recurrence: EVERY_SATURDAY, title: "ごみ出し" });
    const webRuleId = await createCalendarTask(db, householdAMember, {
      managedItemId: null,
      note: null,
      scheduleDayOfMonth: null,
      scheduleDaysOfWeek: [6],
      scheduleKind: "weekly",
      scheduleMonth: null,
      scheduleMonthEnd: false,
      scheduleWeekOfMonth: null,
      title: "ごみ出し",
    }, new Date(MONDAY_NOON));
    const columns = `title, recurrence_basis, deadline_kind, recommended_start_offset, recommended_until_offset,
      schedule_kind, schedule_day_of_week, schedule_day_of_month, schedule_week_of_month, schedule_month,
      schedule_month_end, interval_unit, interval_count, interval_anchor_on, note`;
    const commandRule = await db.prepare(`SELECT ${columns} FROM task_rules r WHERE id = (
      SELECT task_rule_id FROM task_occurrences WHERE id = ?1)`).bind(committed.result.first_occurrence.id).first();
    const webRule = await db.prepare(`SELECT ${columns} FROM task_rules WHERE id = ?1`).bind(webRuleId).first();
    expect(commandRule).toEqual(webRule);
  });

  it("同じ操作の再送では二重に作らない", async () => {
    const service = commandService(db);
    const prepared = await prepare(service, createRequest({ recurrence: { type: "manual" }, title: "電池交換" }));
    const first = await service.commit(principal, commitRequest(prepared));
    await expect(service.commit(principal, commitRequest(prepared))).resolves.toEqual({ ...first, replayed: true });
    await expect(countRows(db, "SELECT count(*) AS count FROM task_rules WHERE title = '電池交換'")).resolves.toBe(1);
    expect(first).toMatchObject({ result: { first_occurrence: { scheduled_on: null }, recurrence: "manual" } });
  });

  it("担当・管理対象・必達日・メモを一度に設定する", async () => {
    const committed = await run(commandService(db), {
      assignee_id: familyMember.userId,
      managed_item_id: "item-a",
      must_complete_by: "2026-10-31",
      note: "手順\r\nを確認",
      recurrence: { scheduled_on: "2026-10-20", type: "one_time" },
      title: "点検の予約",
    });
    await expect(db.prepare(`SELECT o.assignee_user_id, o.must_complete_by, o.scheduled_for, r.managed_item_id, r.note
      FROM task_occurrences o JOIN task_rules r ON r.id = o.task_rule_id WHERE o.id = ?1`)
      .bind(committed.result.first_occurrence.id).first()).resolves.toEqual({
      assignee_user_id: familyMember.userId,
      managed_item_id: "item-a",
      must_complete_by: "2026-10-31",
      note: "手順\nを確認",
      scheduled_for: "2026-10-19T15:00:00.000Z",
    });
  });

  it("固定間隔は起点日から、登録日以降の最初の候補を初回にする", async () => {
    const committed = await run(commandService(db), {
      recurrence: { count: 2, start_on: "2026-10-01", type: "interval", unit: "week" },
      title: "シーツ交換",
    });
    await expect(scheduledOn(committed.result.first_occurrence.id)).resolves.toEqual({
      due_at: "2026-10-14T15:00:00.000Z",
      scheduled_for: "2026-10-14T15:00:00.000Z",
    });
  });
});

describe("入力の確認", () => {
  it("初回の手掛かりが無い完了日基準は、仮定せずに足りない項目として返す", async () => {
    const service = commandService(db);
    const error = await expectCommandError(
      service.prepare(principal, createRequest({ recurrence: { max: 7, min: 7, type: "completion", unit: "day" }, title: "掃除" })),
      "missing_required",
    );
    expect(error.fieldErrors).toEqual({ "payload.recurrence.first_scheduled_on": "required" });
    await expectCommandError(service.prepare(principal, createRequest({ title: "掃除" })), "missing_required");
  });

  it("Webと同じ規則で不正な繰り返し条件を拒否する", async () => {
    const service = commandService(db);
    const emptyWeekdays = await expectCommandError(
      service.prepare(principal, createRequest({ recurrence: { days_of_week: [], kind: "weekly", type: "calendar" }, title: "x" })),
      "invalid_input",
    );
    expect(emptyWeekdays.fieldErrors).toEqual({ "payload.recurrence": "empty_weekdays" });
    await expectCommandError(service.prepare(principal, createRequest({
      recurrence: { first_scheduled_on: "2026-10-17", max: 3, min: 7, type: "completion", unit: "day" },
      title: "x",
    })), "invalid_input");
    await expectCommandError(service.prepare(principal, createRequest({
      recurrence: { count: 1, start_on: "2010-01-01", type: "interval", unit: "day" },
      title: "x",
    })), "invalid_input");
    await expectCommandError(service.prepare(principal, {
      ...createRequest({ recurrence: { type: "manual" }, title: "x" }),
      target: { id: "occ", kind: "todo_occurrence" },
    }), "invalid_input");
  });

  it("他の家庭の管理対象や家族でない担当は使えない", async () => {
    const service = commandService(db);
    const item = await expectCommandError(service.prepare(principal, createRequest({
      managed_item_id: "item-b", recurrence: { type: "manual" }, title: "x",
    })), "invalid_input");
    expect(item.fieldErrors).toEqual({ "payload.managed_item_id": "not_found" });
    const assignee = await expectCommandError(service.prepare(principal, createRequest({
      assignee_id: "user-b", recurrence: { type: "manual" }, title: "x",
    })), "invalid_input");
    expect(assignee.fieldErrors).toEqual({ "payload.assignee_id": "not_in_household" });
  });

  it("確認の後、実行の直前に家庭の世代が進めば作らない", async () => {
    const prepared = await prepare(commandService(db), createRequest({ recurrence: { type: "manual" }, title: "電池交換" }));
    const racing = interruptBeforeBatch(db, async () => {
      await db.prepare("UPDATE managed_items SET name = '名前だけ変更' WHERE id = 'item-a'").run();
    });
    await expectCommandError(commandService(racing).commit(principal, commitRequest(prepared)), "stale_preview");
    await expect(countRows(db, "SELECT count(*) AS count FROM task_rules WHERE title = '電池交換'")).resolves.toBe(0);
  });
});

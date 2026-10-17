import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PREVIEW_TTL_MS } from "../../features/integration/commands/contract";
import type { IntegrationPrincipal } from "../../features/integration/principal";
import { revokeConnection } from "./oauth-connections";
import { householdAMember, householdBMember, resetHouseholdFixtures } from "./test-support/households";
import {
  addFamilyMember,
  commandService,
  connectPrincipal,
  countRows,
  createEverySaturdayTodo,
  createSevenDaysAfterTodo,
  expectCommandError,
  familyCompletes,
  familyMember,
  interruptBeforeBatch,
  interruptBeforeStatement,
  testClock,
} from "./test-support/integration-commands";
import { applyAllMigrations } from "./test-support/migrations";

// 外部command(#437)の共通の受付記録と、todo.completeを実D1で確かめる。
// 再送・同ID別内容・古いpreview・家族の同時完了・接続の解除を、業務データと
// 受付記録の両方が全成功か全取消になることまで含めて検証する。
const db = env.DB;
const memberA = { householdId: "household-a", userId: householdAMember.userId };

type Prepared = { fingerprint: string; operation_id: string; preview_id: string } & Record<string, unknown>;

let principal: IntegrationPrincipal;

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await resetHouseholdFixtures(db);
  await addFamilyMember(db);
  principal = await connectPrincipal(db, memberA);
});

function completeRequest(occurrenceId: string, payload: Record<string, unknown> = {}, operationId = crypto.randomUUID()) {
  return { command: "todo.complete", operation_id: operationId, payload, target: { id: occurrenceId, kind: "todo_occurrence" } };
}

function commitRequest(prepared: Prepared) {
  return { fingerprint: prepared.fingerprint, operation_id: prepared.operation_id, preview_id: prepared.preview_id };
}

async function prepare(service: ReturnType<typeof commandService>, request: unknown): Promise<Prepared> {
  return await service.prepare(principal, request) as Prepared;
}

async function completedLogs(occurrenceId: string): Promise<number> {
  return countRows(db, "SELECT count(*) AS count FROM activity_logs WHERE task_occurrence_id = ?1 AND action = 'completed'", occurrenceId);
}

async function occurrencesOf(occurrenceId: string): Promise<number> {
  return countRows(db, `SELECT count(*) AS count FROM task_occurrences
    WHERE task_rule_id = (SELECT task_rule_id FROM task_occurrences WHERE id = ?1)`, occurrenceId);
}

async function receiptStatus(operationId: string): Promise<{ reason_code: string | null; status: string } | null> {
  return db.prepare("SELECT status, reason_code FROM integration_operations WHERE operation_id = ?1")
    .bind(operationId).first();
}

describe("todo.complete", () => {
  it("previewで今回の完了と次回の予定を示し、commitで同じ内容を一度だけ記録する", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const service = commandService(db);
    const prepared = await prepare(service, completeRequest(occurrenceId));

    expect(prepared).toMatchObject({
      confirmation: { reason_codes: [], state: "not_needed" },
      diff: { occurred_at: "2026-10-12T03:00:00.000Z", occurred_source: "prepared_at", performer_id: "user-a", status: { from: "pending", to: "completed" } },
      expires_at: "2026-10-12T03:10:00.000Z",
      reference_date: "2026-10-12",
      schedule_effect: { next_occurrence: { scheduled_on: "2026-10-19" }, recurrence: "completion" },
      status: "prepared",
    });
    await expect(completedLogs(occurrenceId)).resolves.toBe(0);

    const committed = await service.commit(principal, commitRequest(prepared));
    expect(committed).toMatchObject({
      replayed: false,
      result: {
        detail_url: `/todos/${occurrenceId}`,
        occurred_on: "2026-10-12",
        occurrence_id: occurrenceId,
        performer_id: "user-a",
        undo_available: true,
      },
      status: "succeeded",
    });
    await expect(completedLogs(occurrenceId)).resolves.toBe(1);
    await expect(occurrencesOf(occurrenceId)).resolves.toBe(2);
    await expect(receiptStatus(prepared.operation_id)).resolves.toEqual({ reason_code: null, status: "succeeded" });
  });

  it("同じ操作の再送は保存した結果を返し、二重の完了や次回分の誤完了を起こさない", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const clock = testClock();
    const service = commandService(db, clock);
    const request = completeRequest(occurrenceId);
    const prepared = await prepare(service, request);
    const first = await service.commit(principal, commitRequest(prepared));

    // 応答を失ったクライアントが同じprepare・commitを再送する。previewの期限後も同じ結果。
    expect(await prepare(service, request)).toMatchObject({ preview_id: prepared.preview_id, status: "succeeded" });
    clock.advance(PREVIEW_TTL_MS * 3);
    const again = await service.commit(principal, commitRequest(prepared));
    expect(again).toEqual({ ...first, replayed: true });

    await expect(completedLogs(occurrenceId)).resolves.toBe(1);
    await expect(occurrencesOf(occurrenceId)).resolves.toBe(2);
    await expect(service.get(principal, { operation_id: prepared.operation_id })).resolves.toMatchObject({
      result: first.result,
      status: "succeeded",
    });
  });

  it("同じ操作IDで別の内容を送ると競合になり、previewを置き換えない", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const service = commandService(db);
    const request = completeRequest(occurrenceId, { occurred_on: "2026-10-11" });
    const prepared = await prepare(service, request);

    await expectCommandError(
      service.prepare(principal, { ...request, payload: { occurred_on: "2026-10-12" } }),
      "idempotency_conflict",
    );
    await expectCommandError(
      service.commit(principal, { ...commitRequest(prepared), fingerprint: "0".repeat(64) }),
      "idempotency_conflict",
    );
    await expect(prepare(service, request)).resolves.toMatchObject({ diff: { occurred_on: "2026-10-11" } });
    await expect(completedLogs(occurrenceId)).resolves.toBe(0);
  });

  it("昨日の実施を今日記録すると、実施日と記録日時を分けて残す", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const service = commandService(db);
    const prepared = await prepare(service, completeRequest(occurrenceId, { occurred_on: "2026-10-11" }));
    expect(prepared).toMatchObject({
      diff: { date_precision: "day", occurred_on: "2026-10-11", occurred_source: "specified" },
      reference_date: "2026-10-12",
      schedule_effect: { next_occurrence: { scheduled_on: "2026-10-18" } },
    });

    const committed = await service.commit(principal, commitRequest(prepared));
    expect(committed).toMatchObject({ recorded_at: "2026-10-12T03:00:00.000Z", result: { occurred_on: "2026-10-11" } });
    await expect(db.prepare("SELECT occurred_at FROM activity_logs WHERE task_occurrence_id = ?1").bind(occurrenceId).first())
      .resolves.toEqual({ occurred_at: "2026-10-10T15:00:00.000Z" });
  });

  it("未来の実施日や未知の項目は受け付けない", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const service = commandService(db);
    const future = await expectCommandError(
      service.prepare(principal, completeRequest(occurrenceId, { occurred_on: "2026-10-13" })),
      "invalid_input",
    );
    expect(future.fieldErrors).toEqual({ "payload.occurred_on": "future_date" });
    await expectCommandError(service.prepare(principal, completeRequest(occurrenceId, { note: "x" })), "invalid_input");
    await expectCommandError(
      service.prepare(principal, { ...completeRequest(occurrenceId), expected_revision: "rev" }),
      "invalid_input",
    );
    await expect(countRows(db, "SELECT count(*) AS count FROM integration_operations")).resolves.toBe(0);
  });

  it("次回の予定日が既存の回と重なる過去日の完了は、再試行しても通らない入力として返す", async () => {
    // 最初の回は10月10日。10月3日の実施なら7日後の次回も10月10日になり、今回と重なる。
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const error = await expectCommandError(
      commandService(db).prepare(principal, completeRequest(occurrenceId, { occurred_on: "2026-10-03" })),
      "invalid_input",
    );
    expect(error.fieldErrors).toEqual({ payload: "next_schedule_taken" });
    expect(error.retryable).toBe(false);
    await expect(completedLogs(occurrenceId)).resolves.toBe(0);
  });

  it("毎週土曜と実施から7日後を区別して次回を示す", async () => {
    const saturday = await createEverySaturdayTodo(db);
    const sevenDays = await createSevenDaysAfterTodo(db);
    const service = commandService(db);

    await expect(prepare(service, completeRequest(saturday))).resolves.toMatchObject({
      schedule_effect: { next_occurrence: { scheduled_on: "2026-10-17" }, recurrence: "calendar" },
    });
    await expect(prepare(service, completeRequest(sevenDays))).resolves.toMatchObject({
      schedule_effect: { next_occurrence: { scheduled_on: "2026-10-19" }, recurrence: "completion" },
    });
  });
});

describe("古いpreviewと同時の更新", () => {
  it("期限を過ぎたpreviewは実行せず、期限切れとして確定させる", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const clock = testClock();
    const service = commandService(db, clock);
    const prepared = await prepare(service, completeRequest(occurrenceId));
    clock.advance(PREVIEW_TTL_MS);

    await expectCommandError(service.commit(principal, commitRequest(prepared)), "preview_expired");
    await expectCommandError(service.commit(principal, commitRequest(prepared)), "preview_expired");
    await expect(receiptStatus(prepared.operation_id)).resolves.toEqual({ reason_code: "preview_expired", status: "expired" });
    await expect(completedLogs(occurrenceId)).resolves.toBe(0);
  });

  it("previewの後に次回の計算が変わったら実行せず、再確認を求める", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const service = commandService(db);
    const prepared = await prepare(service, completeRequest(occurrenceId));
    // 旧Webなど、このWorker以外からの更新もそのまま検知する。
    await db.prepare(`UPDATE task_rules SET recommended_start_offset = 14, recommended_until_offset = 14
      WHERE id = (SELECT task_rule_id FROM task_occurrences WHERE id = ?1)`).bind(occurrenceId).run();

    await expectCommandError(service.commit(principal, commitRequest(prepared)), "stale_preview");
    await expectCommandError(service.commit(principal, commitRequest(prepared)), "stale_preview");
    await expect(receiptStatus(prepared.operation_id)).resolves.toEqual({ reason_code: "stale_preview", status: "rejected" });
    await expect(completedLogs(occurrenceId)).resolves.toBe(0);
  });

  it("家族が先に完了していれば、この操作で完了したとは返さない", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const service = commandService(db);
    const prepared = await prepare(service, completeRequest(occurrenceId));
    await familyCompletes(db, occurrenceId, "2026-10-12T02:00:00.000Z");

    const error = await expectCommandError(service.commit(principal, commitRequest(prepared)), "already_resolved");
    expect(error.currentState).toMatchObject({ performer_id: familyMember.userId, status: "completed" });
    // 応答を失って再送・照合しても、最初と同じ詳細を返す。
    const replayed = await expectCommandError(service.commit(principal, commitRequest(prepared)), "already_resolved");
    expect(replayed.currentState).toEqual(error.currentState);
    await expect(service.get(principal, { operation_id: prepared.operation_id })).resolves.toMatchObject({
      error: { code: "already_resolved", current_state: error.currentState },
      status: "rejected",
    });
    await expect(completedLogs(occurrenceId)).resolves.toBe(1);
    await expect(occurrencesOf(occurrenceId)).resolves.toBe(2);
  });

  it("確認の後、実行の直前に家族が完了しても、業務データと受付記録のどちらも残さない", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const prepared = await prepare(commandService(db), completeRequest(occurrenceId));
    const racing = interruptBeforeBatch(db, () => familyCompletes(db, occurrenceId, "2026-10-12T02:00:00.000Z"));

    await expectCommandError(commandService(racing).commit(principal, commitRequest(prepared)), "already_resolved");
    await expect(completedLogs(occurrenceId)).resolves.toBe(1);
    await expect(occurrencesOf(occurrenceId)).resolves.toBe(2);
    await expect(receiptStatus(prepared.operation_id)).resolves.toEqual({ reason_code: "already_resolved", status: "rejected" });
  });

  it("実行の直前に接続が解除されたら、業務データを変更しない", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const prepared = await prepare(commandService(db), completeRequest(occurrenceId));
    const racing = interruptBeforeBatch(db, async () => {
      await revokeConnection(db, principal.connectionId, "user_revoked", new Date().toISOString());
    });

    await expectCommandError(commandService(racing).commit(principal, commitRequest(prepared)), "connection_revoked");
    await expect(completedLogs(occurrenceId)).resolves.toBe(0);
    await expect(receiptStatus(prepared.operation_id)).resolves.toEqual({ reason_code: null, status: "prepared" });
  });
});

describe("家庭の世代(revision)", () => {
  async function revisionOf(kind: string, id: string): Promise<string> {
    const row = await db.prepare("SELECT epoch, version FROM household_read_versions WHERE household_id = 'household-a'")
      .first<{ epoch: string; version: number }>();
    if (row === null) throw new Error("revision not found");
    return JSON.stringify([1, kind, id, row.epoch, row.version]);
  }

  it("読み取ったときのrevisionで確認でき、その後に更新されていれば再確認になる", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const service = commandService(db);
    const fresh = await revisionOf("todo_occurrence", occurrenceId);
    await expect(prepare(service, { ...completeRequest(occurrenceId), expected_revision: fresh }))
      .resolves.toMatchObject({ status: "prepared" });

    const other = await createSevenDaysAfterTodo(db);
    await expectCommandError(
      service.prepare(principal, { ...completeRequest(other), expected_revision: fresh }),
      "invalid_input",
    );
    await expectCommandError(
      service.prepare(principal, { ...completeRequest(other), expected_revision: fresh.replace(occurrenceId, other) }),
      "stale_preview",
    );
  });

  it("成功結果に書き込み後のrevisionを含め、続く取消のexpected_revisionに使える", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const service = commandService(db);
    const prepared = await prepare(service, completeRequest(occurrenceId));
    const committed = await service.commit(principal, commitRequest(prepared));
    const result = committed.result as { completion_log_id: string; revision: string };

    expect(result.revision).toBe(await revisionOf("todo_occurrence", occurrenceId));
    await expect(service.commit(principal, commitRequest(prepared))).resolves.toMatchObject({ result: { revision: result.revision } });
    await expect(service.prepare(principal, {
      command: "todo.undo",
      expected_revision: result.revision,
      operation_id: crypto.randomUUID(),
      payload: { completion_log_id: result.completion_log_id },
    })).resolves.toMatchObject({ status: "prepared" });
  });

  it("previewの保存の直前に家庭の世代が進めば保存せず、同じ操作IDで再試行できる", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const request = completeRequest(occurrenceId);
    const racing = interruptBeforeStatement(db, "INSERT INTO integration_operations", async () => {
      await db.prepare("UPDATE managed_items SET name = '名前だけ変更' WHERE id = 'item-a'").run();
    });

    await expectCommandError(commandService(racing).prepare(principal, request), "temporarily_unavailable");
    await expect(countRows(db, "SELECT count(*) AS count FROM integration_operations")).resolves.toBe(0);
    const retried = await prepare(commandService(db), request);
    await expect(commandService(db).commit(principal, commitRequest(retried))).resolves.toMatchObject({ status: "succeeded" });
  });

  it("確認の後に家族が無関係なものを更新しても、保守的に再確認を求める", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const service = commandService(db);
    const prepared = await prepare(service, completeRequest(occurrenceId));
    await db.prepare("UPDATE managed_items SET name = '名前だけ変更' WHERE id = 'item-a'").run();

    await expectCommandError(service.commit(principal, commitRequest(prepared)), "stale_preview");
    await expect(completedLogs(occurrenceId)).resolves.toBe(0);
  });

  it("確認の後、実行の直前に家庭の世代が進めば、batch全体を取り消す", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const prepared = await prepare(commandService(db), completeRequest(occurrenceId));
    const racing = interruptBeforeBatch(db, async () => {
      await db.prepare("UPDATE managed_items SET name = '名前だけ変更' WHERE id = 'item-a'").run();
    });

    await expectCommandError(commandService(racing).commit(principal, commitRequest(prepared)), "stale_preview");
    await expect(completedLogs(occurrenceId)).resolves.toBe(0);
    await expect(occurrencesOf(occurrenceId)).resolves.toBe(1);
  });
});

describe("権限と家庭の境界", () => {
  it("読み取りだけの接続はprepareできない", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const readOnly = await connectPrincipal(db, { ...memberA, requestedScope: "household.read" });
    await expectCommandError(commandService(db).prepare(readOnly, completeRequest(occurrenceId)), "insufficient_scope");
  });

  it("他の家庭のTodoも、他の接続の操作も見えない", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const service = commandService(db);
    const prepared = await prepare(service, completeRequest(occurrenceId));
    const memberB = await connectPrincipal(db, { householdId: "household-b", userId: householdBMember.userId });

    await expectCommandError(service.prepare(memberB, completeRequest(occurrenceId)), "not_found");
    await expectCommandError(service.commit(memberB, commitRequest(prepared)), "not_found");
    await expect(service.get(memberB, { operation_id: prepared.operation_id })).resolves.toMatchObject({ status: "unknown" });
    // 同じ本人でも、再接続した別の接続からは旧接続の操作を引けない。
    const reconnected = await connectPrincipal(db, memberA);
    await expect(service.get(reconnected, { operation_id: prepared.operation_id }))
      .resolves.toEqual({ operation_id: prepared.operation_id, recovery: "prepare_same_operation", status: "unknown" });
    await expect(completedLogs(occurrenceId)).resolves.toBe(0);
  });
});

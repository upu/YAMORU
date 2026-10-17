import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { IntegrationPrincipal } from "../../features/integration/principal";
import { createHouseholdReader } from "../../features/integration/read";
import { commitReceiptStatement, isCommitReceiptRejection } from "./integration-operations";
import { correctCompletionPerformer } from "./todos";
import { householdAMember, resetHouseholdFixtures } from "./test-support/households";
import {
  addFamilyMember,
  commandService,
  connectPrincipal,
  countRows,
  createOneTimeTodo,
  createSevenDaysAfterTodo,
  expectCommandError,
  familyCompletes,
  familyMember,
  familyRedoesCompletion,
  interruptBeforeBatch,
} from "./test-support/integration-commands";
import { TEST_CLIENT_ID } from "./test-support/oauth";
import { applyAllMigrations } from "./test-support/migrations";

// 完了記録への後からの操作(todo.undo・todo.correct、#437)を実D1で確かめる。
// 取消が家族の後続更新を消さないこと、複数項目の訂正が全成功か全取消になる
// ことを、確認と実行の間に割り込む更新まで含めて検証する。
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

function commitRequest(prepared: Prepared) {
  return { fingerprint: prepared.fingerprint, operation_id: prepared.operation_id, preview_id: prepared.preview_id };
}

async function run(service: Service, request: Record<string, unknown>): Promise<Record<string, unknown>> {
  const prepared = await service.prepare(principal, { operation_id: crypto.randomUUID(), ...request }) as Prepared;
  return service.commit(principal, commitRequest(prepared));
}

// 外部commandで完了させ、完了記録と自動生成された次回のIDを返す。
async function completeByCommand(service: Service, occurrenceId: string, payload: Record<string, unknown> = {}) {
  const committed = await run(service, { command: "todo.complete", payload, target: { id: occurrenceId, kind: "todo_occurrence" } });
  const result = committed.result as { completion_log_id: string; next_occurrence: { id: string } };
  return { completionLogId: result.completion_log_id, nextOccurrenceId: result.next_occurrence.id };
}

async function occurrenceStatus(id: string): Promise<string | null> {
  const row = await db.prepare("SELECT status FROM task_occurrences WHERE id = ?1").bind(id).first<{ status: string }>();
  return row?.status ?? null;
}

async function corrections(): Promise<number> {
  return countRows(db, "SELECT count(*) AS count FROM completion_corrections");
}

// 外部commandで完了させた記録を、家族のやり直しより前の時刻にしておく
// (同じミリ秒に記録されると、どちらが最新かをIDの順で決めることになるため)。
async function completeOneTimeEarlier(service: Service, occurrenceId: string): Promise<string> {
  const committed = await run(service, { command: "todo.complete", target: { id: occurrenceId, kind: "todo_occurrence" } });
  const completionLogId = (committed.result as { completion_log_id: string }).completion_log_id;
  await db.prepare("UPDATE activity_logs SET recorded_at = '2026-10-12T03:00:00.000Z' WHERE id = ?1").bind(completionLogId).run();
  return completionLogId;
}

async function latestCompletionPerformer(occurrenceId: string): Promise<unknown> {
  return db.prepare(`SELECT performed_by_user_id FROM activity_logs
    WHERE task_occurrence_id = ?1 AND action = 'completed' ORDER BY recorded_at DESC, id DESC LIMIT 1`)
    .bind(occurrenceId).first();
}

describe("todo.undo", () => {
  it("誰も触れていない次回だけを取り除き、今回を未完了へ戻す", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const service = commandService(db);
    const { completionLogId, nextOccurrenceId } = await completeByCommand(service, occurrenceId);

    const prepared = await service.prepare(principal, {
      command: "todo.undo",
      operation_id: crypto.randomUUID(),
      payload: { completion_log_id: completionLogId },
    }) as Prepared;
    expect(prepared).toMatchObject({
      diff: { status: { from: "completed", to: "pending" } },
      schedule_effect: { removed_next_occurrence: { id: nextOccurrenceId, scheduled_on: "2026-10-19" } },
    });
    const committed = await service.commit(principal, commitRequest(prepared));

    expect(committed).toMatchObject({ result: { removed_next_occurrence_id: nextOccurrenceId }, status: "succeeded" });
    await expect(occurrenceStatus(occurrenceId)).resolves.toBe("pending");
    await expect(occurrenceStatus(nextOccurrenceId)).resolves.toBeNull();
  });

  it("家族が次回を完了させていれば取り消さず、その記録を残す", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const service = commandService(db);
    const { completionLogId, nextOccurrenceId } = await completeByCommand(service, occurrenceId);
    await familyCompletes(db, nextOccurrenceId, "2026-10-13T03:00:00.000Z");

    await expectCommandError(
      service.prepare(principal, { command: "todo.undo", operation_id: crypto.randomUUID(), payload: { completion_log_id: completionLogId } }),
      "unsafe_undo",
    );
    await expect(occurrenceStatus(occurrenceId)).resolves.toBe("completed");
    await expect(occurrenceStatus(nextOccurrenceId)).resolves.toBe("completed");
  });

  it("確認の後、実行の直前に家族が次回を更新しても、その更新を消さない", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const service = commandService(db);
    const { completionLogId, nextOccurrenceId } = await completeByCommand(service, occurrenceId);
    const prepared = await service.prepare(principal, {
      command: "todo.undo",
      operation_id: crypto.randomUUID(),
      payload: { completion_log_id: completionLogId },
    }) as Prepared;
    const racing = interruptBeforeBatch(db, () => familyCompletes(db, nextOccurrenceId, "2026-10-13T03:00:00.000Z"));

    await expectCommandError(commandService(racing).commit(principal, commitRequest(prepared)), "unsafe_undo");
    await expect(occurrenceStatus(occurrenceId)).resolves.toBe("completed");
    await expect(occurrenceStatus(nextOccurrenceId)).resolves.toBe("completed");
    await expect(countRows(db, "SELECT count(*) AS count FROM activity_logs WHERE action = 'completion_undone'")).resolves.toBe(0);
  });

  it("確認の後に家族が取消と再完了をしていれば、置き換わった完了を取り消さない", async () => {
    const occurrenceId = await createOneTimeTodo(db);
    const service = commandService(db);
    const completionLogId = await completeOneTimeEarlier(service, occurrenceId);
    const prepared = await service.prepare(principal, {
      command: "todo.undo",
      operation_id: crypto.randomUUID(),
      payload: { completion_log_id: completionLogId },
    }) as Prepared;
    const racing = interruptBeforeBatch(db, () => familyRedoesCompletion(db, occurrenceId));

    await expectCommandError(commandService(racing).commit(principal, commitRequest(prepared)), "already_resolved");
    await expect(occurrenceStatus(occurrenceId)).resolves.toBe("completed");
    await expect(latestCompletionPerformer(occurrenceId)).resolves.toEqual({ performed_by_user_id: familyMember.userId });
    await expect(countRows(db, "SELECT count(*) AS count FROM activity_logs WHERE action = 'completion_undone'")).resolves.toBe(1);
  });

  it("取消済みの完了記録は、もう一度取り消さない", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const service = commandService(db);
    const { completionLogId } = await completeByCommand(service, occurrenceId);
    await run(service, { command: "todo.undo", payload: { completion_log_id: completionLogId } });

    await expectCommandError(
      service.prepare(principal, { command: "todo.undo", operation_id: crypto.randomUUID(), payload: { completion_log_id: completionLogId } }),
      "already_resolved",
    );
  });
});

describe("todo.correct", () => {
  it("実施日と実施者を一つの操作で訂正し、次回の予定も計算し直す", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const service = commandService(db);
    const { completionLogId, nextOccurrenceId } = await completeByCommand(service, occurrenceId);

    const prepared = await service.prepare(principal, {
      command: "todo.correct",
      operation_id: crypto.randomUUID(),
      payload: { changes: { occurred_on: "2026-10-10", performer_id: familyMember.userId }, completion_log_id: completionLogId },
    }) as Prepared;
    expect(prepared).toMatchObject({
      diff: {
        occurred_on: { from: "2026-10-12", to: "2026-10-10" },
        performer_id: { from: "user-a", to: familyMember.userId },
      },
      schedule_effect: { next_occurrence: { from: { scheduled_on: "2026-10-19" }, id: nextOccurrenceId, to: { scheduled_on: "2026-10-17" } } },
    });
    const committed = await service.commit(principal, commitRequest(prepared));

    expect(committed).toMatchObject({
      result: { date_precision: "day", occurred_on: "2026-10-10", performer_id: familyMember.userId },
    });
    await expect(corrections()).resolves.toBe(2);
    await expect(db.prepare("SELECT scheduled_for FROM task_occurrences WHERE id = ?1").bind(nextOccurrenceId).first())
      .resolves.toEqual({ scheduled_for: "2026-10-16T15:00:00.000Z" });
  });

  it("実行の直前に次回が更新されたら、実施者だけが訂正されることもない", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const service = commandService(db);
    const { completionLogId, nextOccurrenceId } = await completeByCommand(service, occurrenceId);
    const prepared = await service.prepare(principal, {
      command: "todo.correct",
      operation_id: crypto.randomUUID(),
      payload: { changes: { occurred_on: "2026-10-10", performer_id: familyMember.userId }, completion_log_id: completionLogId },
    }) as Prepared;
    const racing = interruptBeforeBatch(db, () => familyCompletes(db, nextOccurrenceId, "2026-10-13T03:00:00.000Z"));

    await expectCommandError(commandService(racing).commit(principal, commitRequest(prepared)), "unsafe_undo");
    await expect(corrections()).resolves.toBe(0);
    await expect(db.prepare("SELECT status, reason_code FROM integration_operations WHERE operation_id = ?1")
      .bind(prepared.operation_id).first()).resolves.toEqual({ reason_code: "unsafe_undo", status: "rejected" });
  });

  it("確認の後に家族が取消と再完了をしていれば、古い完了記録を訂正しない", async () => {
    const occurrenceId = await createOneTimeTodo(db);
    const service = commandService(db);
    const completionLogId = await completeOneTimeEarlier(service, occurrenceId);
    const prepared = await service.prepare(principal, {
      command: "todo.correct",
      operation_id: crypto.randomUUID(),
      payload: { changes: { occurred_on: "2026-10-11" }, completion_log_id: completionLogId },
    }) as Prepared;
    const racing = interruptBeforeBatch(db, () => familyRedoesCompletion(db, occurrenceId));

    await expectCommandError(commandService(racing).commit(principal, commitRequest(prepared)), "already_resolved");
    await expect(corrections()).resolves.toBe(0);
  });

  it("確認の後、実行の直前に家族が訂正していれば、その訂正を上書きしない", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const service = commandService(db);
    const { completionLogId } = await completeByCommand(service, occurrenceId);
    const prepared = await service.prepare(principal, {
      command: "todo.correct",
      operation_id: crypto.randomUUID(),
      payload: { changes: { occurred_on: "2026-10-11" }, completion_log_id: completionLogId },
    }) as Prepared;
    const racing = interruptBeforeBatch(db, () =>
      correctCompletionPerformer(db, familyMember, occurrenceId, crypto.randomUUID(), familyMember.userId));

    await expectCommandError(commandService(racing).commit(principal, commitRequest(prepared)), "stale_preview");
    await expect(db.prepare("SELECT new_occurred_at, new_performed_by_user_id FROM completion_corrections").all())
      .resolves.toMatchObject({ results: [{ new_occurred_at: null, new_performed_by_user_id: familyMember.userId }] });
  });

  it("訂正後の次回の予定日が既存の回と重なるなら、再試行しても通らない入力として返す", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const service = commandService(db);
    const { completionLogId } = await completeByCommand(service, occurrenceId);

    const error = await expectCommandError(service.prepare(principal, {
      command: "todo.correct",
      operation_id: crypto.randomUUID(),
      payload: { changes: { occurred_on: "2026-10-03" }, completion_log_id: completionLogId },
    }), "invalid_input");
    expect(error.fieldErrors).toEqual({ "payload.changes": "next_schedule_taken" });
    await expect(corrections()).resolves.toBe(0);
  });

  it("空の訂正や現在と同じ値は受け付けない", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const service = commandService(db);
    const { completionLogId } = await completeByCommand(service, occurrenceId);
    const correct = (changes: Record<string, unknown>) => service.prepare(principal, {
      command: "todo.correct",
      operation_id: crypto.randomUUID(),
      payload: { changes, completion_log_id: completionLogId },
    });

    await expectCommandError(correct({}), "invalid_input");
    const unchanged = await expectCommandError(correct({ performer_id: "user-a" }), "invalid_input");
    expect(unchanged.fieldErrors).toEqual({ "payload.changes.performer_id": "unchanged" });
    const outsider = await expectCommandError(correct({ performer_id: "user-b" }), "invalid_input");
    expect(outsider.fieldErrors).toEqual({ "payload.changes.performer_id": "performer_not_in_household" });
    await expect(corrections()).resolves.toBe(0);
  });
});

describe("履歴での接続元", () => {
  it("外部commandによる完了と訂正は接続元を示し、Webからの記録と区別できる", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const service = commandService(db);
    const { completionLogId, nextOccurrenceId } = await completeByCommand(service, occurrenceId);
    await run(service, {
      command: "todo.correct",
      payload: { changes: { occurred_on: "2026-10-11", performer_id: familyMember.userId }, completion_log_id: completionLogId },
    });
    await familyCompletes(db, nextOccurrenceId, "2026-10-13T03:00:00.000Z");

    const reader = createHouseholdReader({
      authorize: () => Promise.resolve(principal),
      cursorSecret: "test-only-secret-with-at-least-32-bytes",
      db,
    });
    const own = await reader.historyList({ id: occurrenceId, kind: "todo_occurrence" });
    expect(own.records.map((record) => [record.kind, record.client_id]).sort()).toEqual([
      ["completed", TEST_CLIENT_ID],
      ["completion_corrected", TEST_CLIENT_ID],
      ["completion_corrected", TEST_CLIENT_ID],
    ]);
    // 実施日だけを指定した訂正は、完了の現在の実施日時も含めて日単位の精度を保つ。
    expect(own.records.filter((record) => record.occurred_at !== null)
      .map((record) => [record.kind, record.date_precision, record.occurred_on]).sort()).toEqual([
      ["completed", "day", "2026-10-11"],
      ["completion_corrected", "day", "2026-10-11"],
    ]);
    const next = await reader.historyList({ id: nextOccurrenceId, kind: "todo_occurrence" });
    expect(next.records.map((record) => [record.kind, record.client_id, record.date_precision]))
      .toEqual([["completed", null, "unknown"]]);
  });
});

describe("受付記録の成功条件", () => {
  it("業務の記録が書けていなければ、受付記録だけを成功にしない", async () => {
    const occurrenceId = await createSevenDaysAfterTodo(db);
    const service = commandService(db);
    const prepared = await service.prepare(principal, {
      command: "todo.complete",
      operation_id: crypto.randomUUID(),
      target: { id: occurrenceId, kind: "todo_occurrence" },
    }) as Prepared;
    const row = await db.prepare("SELECT id, business_key FROM integration_operations WHERE operation_id = ?1")
      .bind(prepared.operation_id).first<{ business_key: string; id: string }>();
    if (row === null) throw new Error("operation not found");

    const error = await db.batch([commitReceiptStatement(db, {
      at: "2026-10-12T03:01:00.000Z",
      evidence: [{ idempotencyKey: row.business_key, table: "activity_logs" }],
      id: row.id,
      result: "{}",
      revisionEntity: { id: occurrenceId, kind: "todo_occurrence" },
    })]).then(() => null, (reason: unknown) => reason);

    expect(isCommitReceiptRejection(error)).toBe(true);
    await expect(db.prepare("SELECT status FROM integration_operations WHERE id = ?1").bind(row.id).first())
      .resolves.toEqual({ status: "prepared" });
  });
});

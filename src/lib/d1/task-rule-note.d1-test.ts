// Issue #329 / YDR-047: Todoのメモ(手順・注意点)をTaskRuleへ持たせる。
// 登録・編集で保存でき、繰り返しTodoでは次のOccurrenceからも同じメモを
// 参照でき、他家庭からは読み書きできないことを確かめる。
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyAllMigrations } from "./test-support/migrations";
import {
  completeTask,
  createIntervalTask,
  createManualTask,
  createOneTimeTask,
  loadTodoDetail,
  updateOneTimeTodo,
  updateRecurringTaskRule,
} from "./todos";

const db = env.DB;
const memberA = { email: "a@example.com", userId: "user-a" };
const memberB = { email: "b@example.com", userId: "user-b" };

const NOTE = "石灰除去剤を1本入れる。\n除去モード終了後、水だけで2回すすぐ。";

function requireOccurrenceId(occurrenceId: string | null): string {
  if (occurrenceId === null) throw new Error("Expected a next occurrence to be generated");
  return occurrenceId;
}

async function pendingOccurrenceId(ruleId: string): Promise<string> {
  const row = await db.prepare(
    "SELECT id FROM task_occurrences WHERE task_rule_id = ?1 AND status = 'pending'",
  ).bind(ruleId).first<{ id: string }>();
  if (row === null) throw new Error("Pending occurrence not found");
  return row.id;
}

async function storedNote(ruleId: string): Promise<string | null> {
  const row = await db.prepare("SELECT note FROM task_rules WHERE id = ?1")
    .bind(ruleId).first<{ note: string | null }>();
  return row?.note ?? null;
}

async function resetFixtures(): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM task_rule_changes"),
    db.prepare("DELETE FROM task_rule_schedules"),
    db.prepare("DELETE FROM task_rule_consumables"),
    db.prepare("DELETE FROM completion_corrections"),
    db.prepare("DELETE FROM activity_logs"),
    db.prepare("DELETE FROM task_occurrences"),
    db.prepare("DELETE FROM task_rules"),
    db.prepare("DELETE FROM managed_items"),
    db.prepare("DELETE FROM household_members"),
    db.prepare("DELETE FROM households"),
    db.prepare("DELETE FROM users"),
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com'), ('user-b', 'b@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A'), ('household-b', 'Household B')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a'), ('household-b', 'user-b')"),
    db.prepare("INSERT INTO managed_items (id, household_id, name, kind) VALUES ('item-a', 'household-a', 'Coffee machine', 'other'), ('item-b', 'household-b', 'Item B', 'other')"),
  ]);
}

describe("Todoのメモの保存と読み取り", () => {
  beforeAll(async () => {
    await applyAllMigrations(db);
  });

  beforeEach(async () => {
    await resetFixtures();
  });

  it("登録時のメモを保存し、Todo詳細から改行を保ったまま読み出す", async () => {
    const ruleId = await createOneTimeTask(db, memberA, {
      managedItemId: "item-a",
      note: NOTE,
      scheduledFor: "2026-09-20T00:00:00.000Z",
      title: "コーヒーマシーンの石灰除去",
    });

    expect(await storedNote(ruleId)).toBe(NOTE);
    const detail = await loadTodoDetail(db, memberA, await pendingOccurrenceId(ruleId));
    expect(detail?.note).toBe(NOTE);
  });

  it("メモ未設定でも登録でき、詳細ではnullとして読める", async () => {
    const ruleId = await createOneTimeTask(db, memberA, {
      managedItemId: null,
      scheduledFor: null,
      title: "メモなしのTodo",
    });

    expect(await storedNote(ruleId)).toBeNull();
    const detail = await loadTodoDetail(db, memberA, await pendingOccurrenceId(ruleId));
    expect(detail?.note).toBeNull();
  });

  it("繰り返しなしTodoの編集でメモを追加・変更・削除できる", async () => {
    const ruleId = await createOneTimeTask(db, memberA, {
      managedItemId: null,
      scheduledFor: null,
      title: "申請",
    });
    const occurrenceId = await pendingOccurrenceId(ruleId);
    const base = {
      assigneeUserId: null,
      managedItemId: null,
      scheduledFor: null,
      title: "申請",
    };

    await updateOneTimeTodo(db, memberA, occurrenceId, { ...base, note: NOTE });
    expect(await storedNote(ruleId)).toBe(NOTE);

    await updateOneTimeTodo(db, memberA, occurrenceId, { ...base, note: "持ち物: 印鑑" });
    expect(await storedNote(ruleId)).toBe("持ち物: 印鑑");

    await updateOneTimeTodo(db, memberA, occurrenceId, { ...base, note: null });
    expect(await storedNote(ruleId)).toBeNull();
  });

  it("繰り返しTodoのルール編集でメモを変更でき、次回Occurrenceからも同じメモを参照できる", async () => {
    const ruleId = await createIntervalTask(db, memberA, {
      intervalAnchorOn: "2026-03-02",
      intervalCount: 2,
      intervalUnit: "week",
      managedItemId: "item-a",
      note: "古い手順",
      title: "水槽の水換え",
    }, new Date("2026-03-02T00:00:00.000Z"));
    const occurrenceId = await pendingOccurrenceId(ruleId);

    await updateRecurringTaskRule(db, memberA, occurrenceId, {
      intervalAnchorOn: "2026-03-02",
      intervalCount: 2,
      intervalUnit: "week",
      managedItemId: "item-a",
      note: NOTE,
      recurrenceBasis: "interval",
      title: "水槽の水換え",
    });
    expect(await storedNote(ruleId)).toBe(NOTE);

    const nextId = requireOccurrenceId(await completeTask(db, memberA, {
      idempotencyKey: "refresh-water",
      occurredAt: "2026-03-02T02:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    }));

    // 次のOccurrenceは同じTaskRuleを指すため、メモを引き継ぐためのコピーは
    // いらない(YDR-047)。
    const nextDetail = await loadTodoDetail(db, memberA, nextId);
    expect(nextDetail?.note).toBe(NOTE);
  });

  it("完了済みTodoの詳細でも現在のメモを読める", async () => {
    const ruleId = await createManualTask(db, memberA, {
      managedItemId: "item-a",
      note: NOTE,
      title: "コーヒーマシーンの石灰除去",
    });
    const occurrenceId = await pendingOccurrenceId(ruleId);
    await completeTask(db, memberA, {
      idempotencyKey: "descale-note",
      occurredAt: "2026-03-10T02:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    });

    const detail = await loadTodoDetail(db, memberA, occurrenceId);
    expect(detail?.status).toBe("completed");
    expect(detail?.note).toBe(NOTE);
  });

  it("他家庭のTodoのメモは読めず、書き換えられない", async () => {
    const ruleId = await createOneTimeTask(db, memberA, {
      managedItemId: "item-a",
      note: NOTE,
      scheduledFor: null,
      title: "家庭Aの手順",
    });
    const occurrenceId = await pendingOccurrenceId(ruleId);

    await expect(loadTodoDetail(db, memberB, occurrenceId)).resolves.toBeNull();
    await expect(updateOneTimeTodo(db, memberB, occurrenceId, {
      assigneeUserId: null,
      managedItemId: null,
      note: "他家庭が書いた手順",
      scheduledFor: null,
      title: "Hijacked",
    })).rejects.toThrow("Occurrence not found");

    expect(await storedNote(ruleId)).toBe(NOTE);
  });
});

// 外部command(#437)のD1統合テストが共有する準備。接続は実際のOAuthの流れ
// (同意→token交換→access tokenの検証)で作り、検証済みのprincipalを使う。

import { CommandError, type CommandErrorCode } from "../../../features/integration/commands/contract";
import { createCommandService } from "../../../features/integration/commands/service";
import { verifyAccessToken } from "../../../features/integration/oauth/bearer";
import type { IntegrationPrincipal } from "../../../features/integration/principal";
import { completeTask, createCalendarTask, createMaintenanceTask, createOneTimeTask, undoTaskCompletion } from "../todos";
import { householdAMember, occurrenceForRule } from "./households";
import { connect, registerTestClient, testOAuthConfig } from "./oauth";

// 家庭Aのもう一人の家族。同時の完了や後続の更新を行う。
export const familyMember = { email: "a2@example.com", userId: "user-a2" };

// Asia/Tokyoの2026年10月12日(月)12:00。10月17日・10日は土曜。
export const MONDAY_NOON = "2026-10-12T03:00:00.000Z";

export async function addFamilyMember(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO users (id, email) VALUES (?1, ?2)").bind(familyMember.userId, familyMember.email),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', ?1)").bind(familyMember.userId),
  ]);
}

export async function connectPrincipal(
  db: D1Database,
  input: { householdId: string; requestedScope?: string; userId: string },
): Promise<IntegrationPrincipal> {
  await registerTestClient(db);
  const tokens = await connect(db, input);
  const verified = await verifyAccessToken({ config: testOAuthConfig, db }, tokens.access_token, []);
  if (!verified.ok) throw new Error(`access tokenを検証できません: ${verified.error}`);
  return verified.principal;
}

export function testClock(start = MONDAY_NOON) {
  let now = new Date(start);
  return {
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
    now: () => now,
  };
}

export function commandService(db: D1Database, clock = testClock()) {
  return createCommandService({ db, now: clock.now });
}

// batchの直前に別の処理を割り込ませる。読み取り(previewの再計算)の後、
// 業務更新のbatchまでの間に家族の更新や接続の解除が起きた場合を再現する。
export function interruptBeforeBatch(db: D1Database, interruption: () => Promise<void>): D1Database {
  let pending = true;
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          if (pending) {
            pending = false;
            await interruption();
          }
          return target.batch(statements);
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

export async function expectCommandError(
  promise: Promise<unknown>,
  code: CommandErrorCode,
): Promise<CommandError> {
  const error = await promise.then(() => null, (reason: unknown) => reason);
  if (!(error instanceof CommandError) || error.code !== code) {
    throw new Error(`CommandError(${code})を期待しましたが、${String(error)}でした`, { cause: error });
  }
  return error;
}

// 実施から7日後を次回の予定にするTodo(完了日基準)。
export async function createSevenDaysAfterTodo(db: D1Database): Promise<string> {
  const ruleId = await createMaintenanceTask(db, householdAMember, {
    firstDueAt: "2026-10-09T15:00:00.000Z",
    firstScheduledFor: "2026-10-09T15:00:00.000Z",
    managedItemId: "item-a",
    recommendedStartOffset: 7,
    recommendedUntilOffset: 7,
    title: "フィルター掃除",
  });
  return (await occurrenceForRule(db, ruleId)).id;
}

// 毎週土曜のTodo(定例日基準)。最初の回は10月10日(土)。
export async function createEverySaturdayTodo(db: D1Database): Promise<string> {
  const ruleId = await createCalendarTask(db, householdAMember, {
    managedItemId: null,
    note: null,
    scheduleDayOfMonth: null,
    scheduleDaysOfWeek: [6],
    scheduleKind: "weekly",
    scheduleMonth: null,
    scheduleMonthEnd: false,
    scheduleWeekOfMonth: null,
    title: "ごみ出し",
  }, new Date("2026-10-08T03:00:00.000Z"));
  return (await occurrenceForRule(db, ruleId)).id;
}

// 一回限りのTodo。完了しても次回を作らない。
export async function createOneTimeTodo(db: D1Database): Promise<string> {
  const ruleId = await createOneTimeTask(db, householdAMember, {
    managedItemId: null,
    scheduledFor: "2026-10-10T15:00:00.000Z",
    title: "粗大ごみの申込み",
  });
  return (await occurrenceForRule(db, ruleId)).id;
}

// 家族がWebで完了を取り消し、すぐにもう一度完了させる。
export async function familyRedoesCompletion(db: D1Database, occurrenceId: string): Promise<void> {
  await undoTaskCompletion(db, familyMember, occurrenceId, crypto.randomUUID());
  await familyCompletes(db, occurrenceId, "2026-10-12T04:00:00.000Z");
}

export async function familyCompletes(db: D1Database, occurrenceId: string, occurredAt: string): Promise<void> {
  await completeTask(db, familyMember, {
    idempotencyKey: crypto.randomUUID(),
    occurredAt,
    occurrenceId,
    performedByUserId: null,
  });
}

export async function countRows(db: D1Database, sql: string, ...binds: unknown[]): Promise<number> {
  const row = await db.prepare(sql).bind(...binds).first<{ count: number }>();
  return row?.count ?? 0;
}

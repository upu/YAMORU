import {
  commitReceiptStatement,
  findIntegrationOperation,
  insertPreparedOperation,
  isWriteConnectionActive,
  resolveOperationWithoutCommit,
  revisionGuardStatement,
  type IntegrationOperation,
} from "../../../lib/d1/integration-operations";
import type { IntegrationPrincipal } from "../principal";
import type { IntegrationScope } from "../scopes";
import {
  canonicalJson,
  CommandError,
  isCommandErrorCode,
  isCommandName,
  PREVIEW_TTL_MS,
  sha256Hex,
  type CommandName,
  type NormalizedCommand,
} from "./contract";
import type { CommandContext, CommandHandler, CommandPlan } from "./handler";
import { parseCommitRequest, parseOperationGetRequest, parsePrepareRequest, tokyoDate } from "./input";
import {
  checkExpectedRevision,
  currentRevision,
  parseExpectedRevision,
  sameRevision,
  type HouseholdRevision,
} from "./revision";
import { managedItemCreateHandler, managedItemWithTodoCreateHandler } from "./managed-item-create";
import { todoCompleteHandler } from "./todo-complete";
import { todoCreateHandler } from "./todo-create";
import { todoCorrectHandler, todoUndoHandler } from "./todo-history";
import { notificationConfigureHandler } from "./notification-configure";
import { notificationSnoozeHandler } from "./notification-snooze";
import { stockCorrectHandler, stockObserveHandler, stockRefillHandler } from "./stock";

// command_prepare / command_commit / operation_get(conversation-integration.md
// 5節)。principalは検証済みのaccess tokenからだけ作られたもの(bearer.ts)で、
// 要求本文の利用者・家庭・scopeは採用しない。
//
// 競合は家庭の世代(YDR-053)で検出する。previewを作ったときの世代を保存し、
// commitのbatchの最初の文で同じ世代であることを確かめる(YDR-054)。
// 追加確認(confirmation_url)はまだ扱わない。

const HANDLERS: Record<CommandName, CommandHandler> = {
  "managed_item.create": managedItemCreateHandler,
  "managed_item_with_todo.create": managedItemWithTodoCreateHandler,
  "stock.observe": stockObserveHandler,
  "stock.refill": stockRefillHandler,
  "stock.correct": stockCorrectHandler,
  "todo.complete": todoCompleteHandler,
  "todo.correct": todoCorrectHandler,
  "todo.create": todoCreateHandler,
  "todo.undo": todoUndoHandler,
  "notification.configure": notificationConfigureHandler,
  "notification.snooze": notificationSnoozeHandler,
};

export type CommandServiceDependencies = { db: D1Database; now?: () => Date };

type Request = { deps: CommandServiceDependencies; now: Date; principal: IntegrationPrincipal };

// 運用ログには理由と操作IDだけを残し、家庭データやpayloadを書かない(8節)。
function logFailure(event: string, error: unknown, operationId?: string): void {
  console.warn(JSON.stringify({
    error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    event: `yamoru.integration.${event}`,
    ...(operationId === undefined ? {} : { operation_id: operationId }),
  }));
}

function requireScope(principal: IntegrationPrincipal, scope: IntegrationScope): void {
  if (!principal.scopes.includes(scope)) throw new CommandError("insufficient_scope");
}

function contextOf({ deps, now, principal }: Request): CommandContext {
  return { db: deps.db, householdId: principal.householdId, now, userId: principal.userId };
}

function handlerOf(command: string): CommandHandler {
  if (!isCommandName(command)) throw new Error(`Unknown stored command: ${command}`);
  return HANDLERS[command];
}

// 期限を過ぎたまま確定していない操作も、外からは期限切れとして見せる。
function visibleStatus(operation: IntegrationOperation, now: Date): string {
  return operation.status === "prepared" && operation.expiresAt <= now.toISOString() ? "expired" : operation.status;
}

// 拒否を確定させたときの詳細を、再送やoperation_getでも同じ形で返す。
function storedError(operation: IntegrationOperation): CommandError {
  const code = operation.reasonCode ?? "";
  const detail = JSON.parse(operation.reasonDetail ?? "{}") as {
    current_state?: Record<string, unknown>;
    field_errors?: Record<string, string>;
  };
  return new CommandError(isCommandErrorCode(code) ? code : "temporarily_unavailable", {
    currentState: detail.current_state,
    fieldErrors: detail.field_errors,
    operationId: operation.operationId,
  });
}

function errorDetail(error: CommandError): string | null {
  if (error.currentState === undefined && error.fieldErrors === undefined) return null;
  return canonicalJson({ current_state: error.currentState, field_errors: error.fieldErrors });
}

function outcomeOf(operation: IntegrationOperation, now: Date): Record<string, unknown> {
  const status = visibleStatus(operation, now);
  if (status === "succeeded") return { recorded_at: operation.resolvedAt, result: JSON.parse(operation.result ?? "null") as unknown };
  if (status === "expired" && operation.status === "prepared") {
    return { error: new CommandError("preview_expired", { operationId: operation.operationId }).toWire() };
  }
  if (status === "rejected" || status === "expired") return { error: storedError(operation).toWire() };
  return {};
}

function prepareOutput(operation: IntegrationOperation, now: Date): Record<string, unknown> {
  return {
    operation_id: operation.operationId,
    status: visibleStatus(operation, now),
    preview_id: operation.previewId,
    expires_at: operation.expiresAt,
    // 「今日」「昨日」を解決した基準日。日付の暦はAsia/Tokyoに固定する。
    reference_date: tokyoDate(operation.createdAt),
    time_zone: "Asia/Tokyo",
    normalized_command: JSON.parse(operation.normalizedCommand) as unknown,
    ...(JSON.parse(operation.preview) as Record<string, unknown>),
    confirmation: { reason_codes: [], state: "not_needed" },
    fingerprint: operation.fingerprint,
    household_revision: { epoch: operation.revisionEpoch, version: operation.revisionVersion },
    ...outcomeOf(operation, now),
  };
}

function replayPrepare(operation: IntegrationOperation, requestHash: string, now: Date): Record<string, unknown> {
  if (operation.requestHash !== requestHash) {
    throw new CommandError("idempotency_conflict", { operationId: operation.operationId });
  }
  return prepareOutput(operation, now);
}

async function createOperation(
  request: Request,
  input: {
    normalized: NormalizedCommand;
    operationId: string;
    plan: CommandPlan;
    requestHash: string;
    revision: HouseholdRevision;
  },
): Promise<IntegrationOperation> {
  const { normalized, plan, revision } = input;
  const id = crypto.randomUUID();
  const operation: IntegrationOperation = {
    businessKey: `integration:${id}`,
    clientId: request.principal.clientId,
    command: normalized.command,
    connectionId: request.principal.connectionId,
    createdAt: request.now.toISOString(),
    expiresAt: new Date(request.now.getTime() + PREVIEW_TTL_MS).toISOString(),
    fingerprint: await sha256Hex(canonicalJson({ ...normalized, revisions: [{ kind: "household", ...revision }] })),
    householdId: request.principal.householdId,
    id,
    normalizedCommand: canonicalJson(normalized),
    operationId: input.operationId,
    preview: canonicalJson(plan.preview),
    previewId: crypto.randomUUID(),
    reasonCode: null,
    reasonDetail: null,
    requestHash: input.requestHash,
    resolvedAt: null,
    result: null,
    revisionEpoch: revision.epoch,
    revisionVersion: revision.version,
    status: "prepared",
    userId: request.principal.userId,
  };
  await insertPreparedOperation(request.deps.db, operation);
  return operation;
}

// 読み取りの前後で家庭の世代が同じときだけ、previewとその世代を保存する。
async function planAndSave(
  request: Request,
  parsed: ReturnType<typeof parsePrepareRequest>,
  requestHash: string,
): Promise<HouseholdRevision> {
  const expected = parsed.expectedRevision === undefined ? null : parseExpectedRevision(parsed.expectedRevision);
  const { db } = request.deps;
  const { householdId } = request.principal;
  const handler = HANDLERS[parsed.command];
  const context = contextOf(request);
  const normalized = handler.normalize(context, parsed);
  const revision = await currentRevision(db, householdId);
  const plan = await handler.plan(context, normalized);
  // previewの読み取り中に家族が更新した。保存せず、同じ操作IDでの再試行に委ねる。
  if (!sameRevision(revision, await currentRevision(db, householdId))) throw new CommandError("temporarily_unavailable");
  if (expected !== null) checkExpectedRevision(expected, revision, plan.preview);
  await createOperation(request, { normalized, operationId: parsed.operationId, plan, requestHash, revision });
  return revision;
}

async function prepare(request: Request, input: unknown): Promise<Record<string, unknown>> {
  const parsed = parsePrepareRequest(input);
  requireScope(request.principal, "household.read");
  requireScope(request.principal, parsed.command.startsWith("notification.") ? "notifications.manage" : "household.write");
  const requestHash = await sha256Hex(canonicalJson({
    command: parsed.command,
    expected_revision: parsed.expectedRevision ?? null,
    payload: parsed.payload ?? null,
    target: parsed.target ?? null,
  }));
  const { db } = request.deps;
  const { connectionId } = request.principal;
  const existing = await findIntegrationOperation(db, connectionId, parsed.operationId);
  if (existing !== null) return replayPrepare(existing, requestHash, request.now);
  let revision: HouseholdRevision;
  try {
    revision = await planAndSave(request, parsed, requestHash);
  } catch (error) {
    if (error instanceof CommandError) throw error.withOperation(parsed.operationId);
    throw error;
  }
  // 同じ操作IDで同時にprepareされた場合も、保存された一件と照合する。
  const saved = await findIntegrationOperation(db, connectionId, parsed.operationId);
  if (saved !== null) return replayPrepare(saved, requestHash, request.now);
  // 保存の直前に家族が更新した場合は何も残っていないので、同じ操作IDで再試行できる。
  const latest = await currentRevision(db, request.principal.householdId);
  const code = sameRevision(latest, revision) ? "connection_revoked" : "temporarily_unavailable";
  throw new CommandError(code, { operationId: parsed.operationId });
}

async function reload(request: Request, operation: IntegrationOperation): Promise<IntegrationOperation> {
  const latest = await findIntegrationOperation(request.deps.db, operation.connectionId, operation.operationId);
  if (latest === null) throw new CommandError("not_found", { operationId: operation.operationId });
  return latest;
}

function successOutput(operation: IntegrationOperation, replayed: boolean): Record<string, unknown> {
  return {
    status: "succeeded",
    operation_id: operation.operationId,
    replayed,
    recorded_at: operation.resolvedAt,
    result: JSON.parse(operation.result ?? "null") as unknown,
  };
}

// 未実行の操作を拒否・期限切れとして確定させる。同時のcommitが先に成功して
// いれば、その結果を返す。
async function resolveWithoutCommit(
  request: Request,
  operation: IntegrationOperation,
  error: CommandError,
): Promise<Record<string, unknown>> {
  const status = error.code === "preview_expired" ? "expired" : "rejected";
  const now = request.now.toISOString();
  const reason = { code: error.code, detail: errorDetail(error) };
  if (!await resolveOperationWithoutCommit(request.deps.db, operation.id, status, reason, now)) {
    return settle(request, await reload(request, operation));
  }
  throw error.withOperation(operation.operationId);
}

async function replan(request: Request, operation: IntegrationOperation): Promise<CommandPlan | Record<string, unknown>> {
  const normalized = JSON.parse(operation.normalizedCommand) as NormalizedCommand;
  try {
    const plan = await handlerOf(normalized.command).plan(contextOf(request), normalized);
    const revision = await currentRevision(request.deps.db, operation.householdId);
    const unchanged = canonicalJson(plan.preview) === operation.preview &&
      sameRevision(revision, { epoch: operation.revisionEpoch, version: operation.revisionVersion });
    if (unchanged) return plan;
    return await resolveWithoutCommit(request, operation, new CommandError("stale_preview"));
  } catch (error) {
    if (error instanceof CommandError && error.final) return resolveWithoutCommit(request, operation, error);
    if (error instanceof CommandError) throw error.withOperation(operation.operationId);
    throw error;
  }
}

function isPlan(value: CommandPlan | Record<string, unknown>): value is CommandPlan {
  return typeof (value as Partial<CommandPlan>).build === "function";
}

// batchが取り消された理由を、確定した状態から順に調べて返す。
async function diagnose(request: Request, operation: IntegrationOperation, cause: unknown): Promise<Record<string, unknown>> {
  const latest = await reload(request, operation);
  if (latest.status !== "prepared" || latest.expiresAt <= request.now.toISOString()) return settle(request, latest);
  if (!await isWriteConnectionActive(request.deps.db, operation.id, request.now.toISOString())) {
    throw new CommandError("connection_revoked", { operationId: operation.operationId });
  }
  const plan = await replan(request, latest);
  if (!isPlan(plan)) return plan;
  // 状態は変わっていないのに実行できなかった。原因を特定できないため確定させず、
  // 同じ操作IDでの照合・再試行に委ねる。
  logFailure("commit_failed", cause, operation.operationId);
  throw new CommandError("temporarily_unavailable", { operationId: operation.operationId });
}

async function execute(request: Request, operation: IntegrationOperation): Promise<Record<string, unknown>> {
  const plan = await replan(request, operation);
  if (!isPlan(plan)) return plan;
  const recordedAt = request.now.toISOString();
  const execution = plan.build({ businessKey: operation.businessKey, recordedAt });
  const { db } = request.deps;
  try {
    await db.batch([
      revisionGuardStatement(db, operation.id),
      ...execution.statements,
      commitReceiptStatement(db, {
        at: recordedAt,
        evidence: execution.evidence,
        id: operation.id,
        result: canonicalJson(execution.result),
        revisionEntity: execution.revisionEntity,
        revisionPlacements: execution.revisionPlacements,
      }),
    ]);
  } catch (error) {
    return diagnose(request, operation, error);
  }
  // 保存した結果(書き込み後のrevisionを含む)を返し、再送・照合と同じ内容にする。
  return successOutput(await reload(request, operation), false);
}

async function settle(request: Request, operation: IntegrationOperation): Promise<Record<string, unknown>> {
  // 成功済みの再送は、previewの期限後でも保存した結果を返し、再実行しない。
  if (operation.status === "succeeded") return successOutput(operation, true);
  if (operation.status !== "prepared") throw storedError(operation);
  if (operation.expiresAt <= request.now.toISOString()) {
    return resolveWithoutCommit(request, operation, new CommandError("preview_expired"));
  }
  return execute(request, operation);
}

async function commit(request: Request, input: unknown): Promise<Record<string, unknown>> {
  requireScope(request.principal, "household.read");
  const parsed = parseCommitRequest(input);
  const operation = await findIntegrationOperation(request.deps.db, request.principal.connectionId, parsed.operationId);
  if (operation === null) throw new CommandError("not_found", { operationId: parsed.operationId });
  requireScope(request.principal, operation.command.startsWith("notification.") ? "notifications.manage" : "household.write");
  // payloadは再入力させない。previewと内容の指紋が保存した操作と一致することだけを確かめる。
  if (operation.previewId !== parsed.previewId || operation.fingerprint !== parsed.fingerprint) {
    throw new CommandError("idempotency_conflict", { operationId: parsed.operationId });
  }
  return settle(request, operation);
}

async function get(request: Request, input: unknown): Promise<Record<string, unknown>> {
  requireScope(request.principal, "household.read");
  const parsed = parseOperationGetRequest(input);
  const operation = await findIntegrationOperation(request.deps.db, request.principal.connectionId, parsed.operationId);
  // prepareの応答を失い、受付記録が作られなかった操作。対象が無いという意味の
  // not_foundとは区別し、同じ操作IDでprepareからやり直せることを示す。
  if (operation === null) {
    return { operation_id: parsed.operationId, recovery: "prepare_same_operation", status: "unknown" };
  }
  if (operation.command.startsWith("notification.")) requireScope(request.principal, "notifications.manage");
  return {
    operation_id: operation.operationId,
    command: operation.command,
    status: visibleStatus(operation, request.now),
    preview_id: operation.previewId,
    fingerprint: operation.fingerprint,
    created_at: operation.createdAt,
    expires_at: operation.expiresAt,
    resolved_at: operation.resolvedAt,
    ...outcomeOf(operation, request.now),
  };
}

// 予期しない失敗は、内部の詳細を外へ出さず一時的な失敗として返す。
async function guarded(run: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CommandError) throw error;
    logFailure("command_failed", error);
    throw new CommandError("temporarily_unavailable");
  }
}

export function createCommandService(deps: CommandServiceDependencies) {
  const requestOf = (principal: IntegrationPrincipal): Request => ({
    deps,
    now: deps.now?.() ?? new Date(),
    principal,
  });
  return {
    commit: (principal: IntegrationPrincipal, input: unknown) => guarded(() => commit(requestOf(principal), input)),
    get: (principal: IntegrationPrincipal, input: unknown) => guarded(() => get(requestOf(principal), input)),
    prepare: (principal: IntegrationPrincipal, input: unknown) => guarded(() => prepare(requestOf(principal), input)),
  };
}

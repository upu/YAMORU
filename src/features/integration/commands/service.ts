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
  isCommandName,
  PREVIEW_TTL_MS,
  sha256Hex,
  type CommandName,
  type NormalizedCommand,
} from "./contract";
import {
  confirmationOutput,
  createConfirmationTokens,
  decideConfirmation,
  meaningfulDigestOf,
  subjectKeyOf,
  visibleConfirmationStatus,
} from "./confirmation";
import type { CommandContext, CommandHandler, CommandPlan } from "./handler";
import { errorDetail, outcomeOf, prepareOutput, storedError, successOutput, visibleStatus } from "./output";
import { parseCommitRequest, parseOperationGetRequest, parsePrepareRequest } from "./input";
import {
  checkExpectedRevision,
  currentRevision,
  parseExpectedRevision,
  sameRevision,
  type HouseholdRevision,
} from "./revision";
import { managedItemCreateHandler, managedItemWithTodoCreateHandler } from "./managed-item-create";
import { managedItemUpdateHandler } from "./managed-item-update";
import { todoCompleteHandler } from "./todo-complete";
import { todoCreateHandler } from "./todo-create";
import { todoCorrectHandler, todoUndoHandler } from "./todo-history";
import { notificationConfigureHandler } from "./notification-configure";
import { notificationSnoozeHandler } from "./notification-snooze";
import { notificationAckHandler, notificationClaimHandler } from "./notification-poll";
import { commandScope } from "./command-scope";
import { stockCorrectHandler, stockObserveHandler, stockRefillHandler } from "./stock";
import { todoRescheduleHandler } from "./todo-reschedule";
import { todoUpdateHandler } from "./todo-update";

// command_prepare / command_commit / operation_get(conversation-integration.md
// 5節)。principalは検証済みのaccess tokenからだけ作られたもの(bearer.ts)で、
// 要求本文の利用者・家庭・scopeは採用しない。
//
// 競合は家庭の世代(YDR-053)で検出する。previewを作ったときの世代を保存し、
// commitのbatchの最初の文で同じ世代であることを確かめる(YDR-054)。
// 古いpreviewを作り直して意味のある差分が出た操作は、YAMORUの確認画面での
// 本人の承認と一回限りのtokenを必須にする(YDR-062)。

const HANDLERS: Record<CommandName, CommandHandler> = {
  "managed_item.create": managedItemCreateHandler,
  "managed_item.update": managedItemUpdateHandler,
  "managed_item_with_todo.create": managedItemWithTodoCreateHandler,
  "stock.observe": stockObserveHandler,
  "stock.refill": stockRefillHandler,
  "stock.correct": stockCorrectHandler,
  "todo.complete": todoCompleteHandler,
  "todo.correct": todoCorrectHandler,
  "todo.create": todoCreateHandler,
  "todo.reschedule": todoRescheduleHandler,
  "todo.undo": todoUndoHandler,
  "todo.update": todoUpdateHandler,
  "notification.configure": notificationConfigureHandler,
  "notification.snooze": notificationSnoozeHandler,
  "notification.claim": notificationClaimHandler,
  "notification.ack": notificationAckHandler,
};

export type CommandServiceDependencies = {
  db: D1Database;
  now?: () => Date;
  commitGuard?: D1PreparedStatement;
  // 確認画面のURLの起点(OAuthのissuer)。無ければ相対パスを返す。
  config?: { issuer: string } | null;
  // 追加確認のtokenを計算する秘密鍵(AUTH_SECRET)。無ければtokenを発行しない。
  cursorSecret?: string;
};

type Request = {
  confirmationToken?: string;
  deps: CommandServiceDependencies;
  now: Date;
  principal: IntegrationPrincipal;
  tokens: ReturnType<typeof createConfirmationTokens>;
};

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

function issuerOf(request: Request): string | null {
  return request.deps.config?.issuer ?? null;
}

function contextOf({ deps, now, principal }: Request): CommandContext {
  return { db: deps.db, householdId: principal.householdId, now, userId: principal.userId, principal };
}

function handlerOf(command: string): CommandHandler {
  if (!isCommandName(command)) throw new Error(`Unknown stored command: ${command}`);
  return HANDLERS[command];
}

function replayPrepare(request: Request, operation: IntegrationOperation, requestHash: string): Record<string, unknown> {
  if (operation.requestHash !== requestHash) {
    throw new CommandError("idempotency_conflict", { operationId: operation.operationId });
  }
  return prepareOutput(operation, request.now, issuerOf(request));
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
  const subjectKey = await subjectKeyOf(normalized);
  const meaningfulDigest = await meaningfulDigestOf(normalized, plan.preview);
  const confirmation = await decideConfirmation(request.deps.db, {
    digest: meaningfulDigest,
    householdId: request.principal.householdId,
    id,
    now: request.now,
    subjectKey,
    userId: request.principal.userId,
  });
  const operation: IntegrationOperation = {
    ...confirmation,
    confirmationDecidedAt: null,
    meaningfulDigest,
    subjectKey,
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
  requireScope(request.principal, commandScope(parsed.command));
  const requestHash = await sha256Hex(canonicalJson({
    command: parsed.command,
    expected_revision: parsed.expectedRevision ?? null,
    payload: parsed.payload ?? null,
    target: parsed.target ?? null,
  }));
  const { db } = request.deps;
  const { connectionId } = request.principal;
  const existing = await findIntegrationOperation(db, connectionId, parsed.operationId);
  if (existing !== null) return replayPrepare(request, existing, requestHash);
  let revision: HouseholdRevision;
  try {
    revision = await planAndSave(request, parsed, requestHash);
  } catch (error) {
    if (error instanceof CommandError) throw error.withOperation(parsed.operationId);
    throw error;
  }
  // 同じ操作IDで同時にprepareされた場合も、保存された一件と照合する。
  const saved = await findIntegrationOperation(db, connectionId, parsed.operationId);
  if (saved !== null) return replayPrepare(request, saved, requestHash);
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
      ...(request.deps.commitGuard ? [request.deps.commitGuard] : []),
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

// 確認が必須の操作は、本人の承認と、その承認に束縛したtokenの両方を求める。
// 欠けていれば確定させず、確認後の同じ操作IDでのcommitに委ねる。
async function requireConfirmation(request: Request, operation: IntegrationOperation): Promise<void> {
  if (operation.confirmationState !== "required") return;
  if (!await request.tokens.verify(operation, request.confirmationToken)) {
    throw new CommandError("confirmation_required", { operationId: operation.operationId });
  }
}

async function settle(request: Request, operation: IntegrationOperation): Promise<Record<string, unknown>> {
  // 成功済みの再送は、previewの期限後でも保存した結果を返し、再実行しない。
  if (operation.status === "succeeded") return successOutput(operation, true);
  if (operation.status !== "prepared") throw storedError(operation);
  if (operation.expiresAt <= request.now.toISOString()) {
    return resolveWithoutCommit(request, operation, new CommandError("preview_expired"));
  }
  await requireConfirmation(request, operation);
  return execute(request, operation);
}

async function commit(request: Request, input: unknown): Promise<Record<string, unknown>> {
  requireScope(request.principal, "household.read");
  const parsed = parseCommitRequest(input);
  const operation = await findIntegrationOperation(request.deps.db, request.principal.connectionId, parsed.operationId);
  if (operation === null) throw new CommandError("not_found", { operationId: parsed.operationId });
  requireScope(request.principal, commandScope(operation.command));
  // payloadは再入力させない。previewと内容の指紋が保存した操作と一致することだけを確かめる。
  if (operation.previewId !== parsed.previewId || operation.fingerprint !== parsed.fingerprint) {
    throw new CommandError("idempotency_conflict", { operationId: parsed.operationId });
  }
  return settle({ ...request, confirmationToken: parsed.confirmationToken }, operation);
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
  if (operation.command.startsWith("notification.")) requireScope(request.principal, commandScope(operation.command));
  return {
    operation_id: operation.operationId,
    command: operation.command,
    status: visibleStatus(operation, request.now),
    preview_id: operation.previewId,
    fingerprint: operation.fingerprint,
    created_at: operation.createdAt,
    expires_at: operation.expiresAt,
    resolved_at: operation.resolvedAt,
    confirmation: confirmationOutput(operation, request.now, issuerOf(request)),
    ...(operation.confirmationState === "required"
      ? { confirmation_status: visibleConfirmationStatus(operation, request.now) }
      : {}),
    ...await confirmationTokenOutput(request, operation),
    ...outcomeOf(operation, request.now),
  };
}

// 承認済み・未実行・期限内で、要求した接続(元の接続)が元commandに必要な
// scopeを持つときだけtokenを返す。別接続の操作はそもそも引けない。
async function confirmationTokenOutput(request: Request, operation: IntegrationOperation): Promise<Record<string, unknown>> {
  if (visibleConfirmationStatus(operation, request.now) !== "approved" || visibleStatus(operation, request.now) !== "prepared") return {};
  if (!request.principal.scopes.includes(commandScope(operation.command))) return {};
  const token = await request.tokens.issue(operation);
  return token === null ? {} : { confirmation_token: token };
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
  const tokens = createConfirmationTokens(deps.cursorSecret);
  const requestOf = (principal: IntegrationPrincipal): Request => ({
    deps,
    now: deps.now?.() ?? new Date(),
    principal,
    tokens,
  });
  return {
    commit: (principal: IntegrationPrincipal, input: unknown) => guarded(() => commit(requestOf(principal), input)),
    get: (principal: IntegrationPrincipal, input: unknown) => guarded(() => get(requestOf(principal), input)),
    prepare: (principal: IntegrationPrincipal, input: unknown) => guarded(() => prepare(requestOf(principal), input)),
  };
}

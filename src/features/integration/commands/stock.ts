import { normalizeStockRecord, StockError } from "../../consumables/stock-contract";
import { normalizeStockCorrection } from "../../consumables/stock-correction";
import { buildStockRecord, planStockRecord } from "../../../lib/d1/consumable-stock-plans";
import { buildStockCorrection, planStockCorrection } from "../../../lib/d1/consumable-stock-correction-plans";
import { D1NotFoundError } from "../../../lib/d1/errors";
import { CommandError, invalidInput, type NormalizedCommand } from "./contract";
import { targetOf, type CommandContext, type CommandHandler, type CommandPlan } from "./handler";
import { idValue, objectValue } from "./input";

type StockCommand = "stock.observe" | "stock.refill" | "stock.correct";
function mapStockError(error: unknown): never {
  if (error instanceof D1NotFoundError) throw new CommandError("not_found");
  if (error instanceof StockError) {
    const field = error.field.replace(/(^|\.)status$/, "$1stock_status");
    throw new CommandError(error.code === "stale_stock" ? "stale_preview" : error.code,
      { fieldErrors: field ? { [field]: error.reason } : undefined });
  }
  throw error;
}
function currentObservation(value: unknown) {
  if (value === undefined) return undefined;
  const p = objectValue(value, "current_observation", ["stock_status", "performer_id"]);
  return { status: p.stock_status, performerId: p.performer_id };
}
function changes(value: unknown) {
  const p = objectValue(value, "changes", ["observed_on", "observed_at", "refilled_on", "refilled_at", "stock_status", "performer_id"]);
  if ((p.observed_on !== undefined || p.observed_at !== undefined) && (p.refilled_on !== undefined || p.refilled_at !== undefined)) throw invalidInput("changes", "one_record_kind_required");
  return { ...(p.observed_on !== undefined || p.refilled_on !== undefined ? { on: p.observed_on ?? p.refilled_on } : {}),
    ...(p.observed_at !== undefined || p.refilled_at !== undefined ? { at: p.observed_at ?? p.refilled_at } : {}),
    ...(p.stock_status !== undefined ? { status: p.stock_status } : {}), ...(p.performer_id !== undefined ? { performerId: p.performer_id } : {}) };
}
function recordInput(command: StockCommand, p: Record<string, unknown>, context: CommandContext, now: Date) {
  return normalizeStockRecord({ kind: command === "stock.refill" ? "refill" : "observation", on: p.observed_on ?? p.refilled_on,
    at: p.observed_at ?? p.refilled_at, status: p.stock_status, performerId: p.performer_id, application: p.application,
    currentObservation: currentObservation(p.current_observation) }, context.userId, now);
}
function correctionInput(p: Record<string, unknown>, context: CommandContext, now: Date) {
  return normalizeStockCorrection({ recordId: p.record_id, recordRevision: p.record_revision, void: p.void,
    changes: p.changes === undefined ? undefined : changes(p.changes), application: p.application, currentObservation: currentObservation(p.current_observation) }, context.userId, now);
}
function normalize(command: StockCommand, context: CommandContext, request: { payload: unknown; target: unknown }): NormalizedCommand {
  const target = objectValue(request.target, "target", ["kind", "id"]);
  if (target.kind !== "consumable") throw invalidInput("target.kind", "consumable_required");
  const id = idValue(target.id, "target.id");
  const fields = command === "stock.correct" ? ["record_id", "record_revision", "changes", "void"]
    : command === "stock.observe" ? ["observed_on", "observed_at", "stock_status", "performer_id"] : ["refilled_on", "refilled_at", "performer_id"];
  const p = objectValue(request.payload, "payload", [...fields, "application", "current_observation"]);
  try {
    if (command === "stock.correct") correctionInput(p, context, context.now);
    else recordInput(command, p, context, context.now);
  } catch (error) { mapStockError(error); }
  // 相対時刻はこの絶対参照時刻からだけ計算し、commit時刻へ動かさない。
  return { command, target: { kind: "consumable", id }, payload: { ...p, reference_at: context.now.toISOString() } };
}
async function plan(context: CommandContext, normalized: NormalizedCommand): Promise<CommandPlan> {
  const owner = { householdId: context.householdId, userId: context.userId };
  const id = targetOf(normalized).id;
  const p = normalized.payload;
  const reference = new Date(String(p.reference_at));
  try {
    if (normalized.command === "stock.correct") {
      const correction = await planStockCorrection(context.db, owner, id, correctionInput(p, context, reference), reference);
      const patch = p.changes as Record<string, unknown> | undefined;
      const wrongDate = correction.original.kind === "refill" ? ["observed_on", "observed_at"] : ["refilled_on", "refilled_at"];
      if (patch && wrongDate.some((key) => key in patch)) throw invalidInput("changes", "record_kind_mismatch");
      return { preview: correction.preview, build: ({ businessKey, recordedAt }) => execution(buildStockCorrection(context.db, correction, businessKey, "integration", recordedAt), id, recordedAt) };
    }
    const record = await planStockRecord(context.db, owner, id, recordInput(normalized.command as StockCommand, p, context, reference), reference);
    return { preview: record.preview, build: ({ businessKey, recordedAt }) => execution(buildStockRecord(context.db, record, businessKey, "integration", recordedAt), id, recordedAt) };
  } catch (error) { mapStockError(error); }
}
function execution(write: ReturnType<typeof buildStockRecord>, id: string, at: string) {
  return { statements: write.statements, result: { ...write.result, recorded_at: at },
    evidence: write.evidenceKeys.map((idempotencyKey) => ({ table: "consumable_stock_events" as const, idempotencyKey })),
    revisionEntity: { kind: "consumable" as const, id } };
}
function handler(command: StockCommand): CommandHandler { return { normalize: (context, request) => normalize(command, context, request), plan }; }
export const stockObserveHandler = handler("stock.observe");
export const stockRefillHandler = handler("stock.refill");
export const stockCorrectHandler = handler("stock.correct");

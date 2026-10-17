import { StockError, type StockRecordInput } from "../../features/consumables/stock-contract";
import { projectStockRecord, type StockFact, type StockProjection } from "../../features/consumables/stock-projection";
import { loadStockState, requireStockPerformer, type StockOwner, type StockState } from "./consumable-stock-read";
import { stockEventStatement, stockGuardRelease, stockGuardStatement, stockProjectionStatements, type StockEventWrite, type StockResult } from "./consumable-stock-statements";

const NEW_RECORD = "@new-stock-record";
const CURRENT_RECORD = "@current-stock-observation";
export async function stockRecordHash(consumableId: string, input: StockRecordInput): Promise<string> {
  const moment = input.moment.current ? "now" : input.moment.at ?? input.moment.on;
  const current = input.currentObservation;
  const text = JSON.stringify(["record", consumableId, input.kind, moment, input.status, input.performerId, input.application,
    current ? [current.status, current.performerId, "now"] : null]);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), (n) => n.toString(16).padStart(2, "0")).join("");
}
function candidate(input: StockRecordInput, now: Date): StockFact {
  return { recordId: NEW_RECORD, eventId: NEW_RECORD, revision: 0, kind: input.kind, occurredOn: input.moment.on, occurredAt: input.moment.at,
    status: input.status, recordedAt: now.toISOString(), voided: false, rootSequence: Number.MAX_SAFE_INTEGER };
}
function recordPreview(state: StockState, input: StockRecordInput, projection: StockProjection) {
  const current = input.currentObservation;
  return { affected_entities: [{ kind: "consumable", id: state.consumableId }],
    diff: { before: { current_stock_status: state.status, stock_revision: state.revision, basis_record_id: state.head?.recordId ?? null },
      after: { record: { kind: input.kind, occurred_on: input.moment.on, occurred_at: input.moment.at, stock_status: input.status, performer_id: input.performerId },
        current_stock_status: projection.status ?? state.status, state_effect: projection.effect,
        current_observation: current ? { stock_status: current.status, performer_id: current.performerId, occurred_at: current.moment.at } : null } },
    schedule_effect: { shared_schedule_changed: false } };
}
export type StockRecordPlan = { owner: StockOwner; state: StockState; input: StockRecordInput; projection: StockProjection; hash: string; preview: ReturnType<typeof recordPreview> };
export async function planStockRecord(db: D1Database, owner: StockOwner, consumableId: string, input: StockRecordInput, now: Date, expectedRevision?: number): Promise<StockRecordPlan> {
  const state = await loadStockState(db, owner, consumableId);
  if (expectedRevision !== undefined && expectedRevision !== state.revision) throw new StockError("stale_stock");
  await requireStockPerformer(db, owner, input.performerId, "performer_id");
  if (input.currentObservation) await requireStockPerformer(db, owner, input.currentObservation.performerId, "current_observation.performer_id");
  const projection: StockProjection = input.currentObservation ? { recordId: CURRENT_RECORD, status: input.currentObservation.status, effect: "applied" }
    : projectStockRecord(state.head, candidate(input, now), input.application, input.moment.current);
  return { owner, state, input, projection, hash: await stockRecordHash(consumableId, input), preview: recordPreview(state, input, projection) };
}
function resolvedHead(projection: StockProjection, recordId: string, currentId: string | null) {
  if (projection.recordId === NEW_RECORD) return recordId;
  if (projection.recordId === CURRENT_RECORD) return currentId;
  return projection.recordId;
}
export function buildStockRecord(db: D1Database, plan: StockRecordPlan, key: string, source: "web" | "integration", at: string) {
  const { owner, state, input, projection } = plan;
  const refillId = input.kind === "refill" ? crypto.randomUUID() : null;
  const recordId = refillId === null ? crypto.randomUUID() : `refill:${refillId}`;
  const currentId = input.currentObservation ? crypto.randomUUID() : null;
  const headId = resolvedHead(projection, recordId, currentId);
  const result: StockResult = { record_id: recordId, event_id: recordId, record_revision: 0, consumable_id: state.consumableId, kind: input.kind,
    occurred_on: input.moment.on, occurred_at: input.moment.at, stock_status: input.status, performer_id: input.performerId,
    current_stock_status: projection.status ?? state.status, state_effect: projection.effect, stock_revision: state.revision + (currentId === null ? 1 : 2),
    current_observation_id: currentId, detail_url: `/consumables/${encodeURIComponent(state.consumableId)}`, record_voided: false };
  const event: StockEventWrite = { id: recordId, recordId, kind: input.kind, action: "created", revision: 0, previousEventId: null, refillId,
    moment: input.moment, status: input.status, performerId: input.performerId, key, hash: plan.hash, result };
  const statements = [stockGuardStatement(db, owner, state, [input.performerId, input.currentObservation?.performerId ?? null])];
  if (refillId !== null) statements.push(db.prepare("INSERT INTO consumable_refills(id,household_id,consumable_id,refilled_on,recorded_at) VALUES(?,?,?,?,?)")
    .bind(refillId, owner.householdId, state.consumableId, input.moment.on, at));
  statements.push(stockEventStatement(db, owner, state.consumableId, event, source, at));
  const evidenceKeys = [key];
  if (input.currentObservation && currentId) {
    const extra = input.currentObservation;
    const extraKey = `${key}:current_observation`;
    statements.push(stockEventStatement(db, owner, state.consumableId, { ...event, id: currentId, recordId: currentId, kind: "observation", refillId: null,
      moment: extra.moment, status: extra.status, performerId: extra.performerId, key: extraKey, result: null }, source, at));
    evidenceKeys.push(extraKey);
  }
  if (projection.effect === "applied" && headId !== null) statements.push(...stockProjectionStatements(db, owner, state.consumableId, headId, result.current_stock_status, at));
  statements.push(stockGuardRelease(db, owner, state.consumableId));
  return { statements, result, evidenceKeys };
}

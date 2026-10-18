import { pollFrame, readPollClaim, selectPollCandidates } from "../../../lib/d1/notification-poll";
import { buildPollAck, buildPollClaim, preparePollAck } from "../../../lib/d1/notification-poll-statements";
import { CommandError, invalidInput, type NormalizedCommand } from "./contract";
import type { CommandContext, CommandHandler } from "./handler";
import { idValue, objectValue } from "./input";
function principalOf(context: CommandContext) {
  const p = context.principal;
  if (!p || p.householdId !== context.householdId || p.userId !== context.userId) throw new CommandError("not_found");
  return p;
}
function normalizeClaim(_context: CommandContext, request: { payload: unknown; target: unknown }): NormalizedCommand {
  const payload = objectValue(request.payload, "payload", ["candidate_ids", "candidate_revisions"]);
  const ids = payload.candidate_ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50) throw invalidInput("candidate_ids", "one_to_fifty_required");
  const parsed = ids.map((id) => idValue(id, "candidate_ids")).sort();
  if (new Set(parsed).size !== parsed.length) throw invalidInput("candidate_ids", "duplicate_id");
  const revisions = objectValue(payload.candidate_revisions, "candidate_revisions", parsed);
  if (Object.keys(revisions).length !== parsed.length || parsed.some((id) => !Object.hasOwn(revisions, id) || typeof revisions[id] !== "string" || revisions[id].length > 256)) throw invalidInput("candidate_revisions", "revision_per_candidate_required");
  if (request.target !== undefined && request.target !== null) throw invalidInput("target", "multiple_candidates");
  return { command: "notification.claim", target: null, payload: { candidate_ids: parsed, candidate_revisions: revisions } };
}
function normalizeAck(_context: CommandContext, request: { payload: unknown; target: unknown }): NormalizedCommand {
  const payload = objectValue(request.payload, "payload", ["delivery_id", "lease_token", "outcome"]);
  const id = idValue(payload.delivery_id, "delivery_id"); const token = idValue(payload.lease_token, "lease_token");
  if (payload.outcome !== "reported" && payload.outcome !== "unknown") throw invalidInput("outcome", "reported_or_unknown_required");
  if (request.target !== undefined && request.target !== null) {
    const target = objectValue(request.target, "target", ["kind", "id"]);
    if (target.kind !== "notification_delivery" || target.id !== id) throw invalidInput("target", "delivery_mismatch");
  }
  return { command: "notification.ack", target: { kind: "notification_delivery", id }, payload: { lease_token: token, outcome: payload.outcome } };
}
export const notificationClaimHandler: CommandHandler = { normalize: normalizeClaim, async plan(context, normalized) {
  const p = principalOf(context);
  const selection = await selectPollCandidates(context.db, p, normalized.payload.candidate_ids as string[], normalized.payload.candidate_revisions as Record<string, string>, context.now);
  return {
    preview: { affected_entities: selection.selected.map((s) => ({ kind: "attention_candidate", id: s.id })),
      diff: { after: { candidates: selection.selected.map((s) => ({ candidate_id: s.id, name: s.evaluation.candidate?.name })), skipped_reasons: selection.skipped } },
      schedule_effect: { shared_schedule_changed: false, claim_seconds: 300, unacknowledged_outcome: "unknown" } },
    build: ({ businessKey, recordedAt }) => buildPollClaim(context.db, p, selection, businessKey, recordedAt),
  };
} };
export const notificationAckHandler: CommandHandler = { normalize: normalizeAck, async plan(context, normalized) {
  const p = principalOf(context); const frame = await pollFrame(context.db, p, context.now);
  if (!normalized.target) throw new CommandError("not_found");
  const row = await readPollClaim(context.db, p, normalized.target.id, normalized.payload.lease_token as string);
  const outcome = normalized.payload.outcome as "reported" | "unknown";
  const members = await preparePollAck(context.db, p, row, outcome, context.now);
  return { preview: { affected_entities: [{ kind: "notification_delivery", id: row.id }], diff: { after: { outcome, candidate_count: row.item_count } }, schedule_effect: { shared_schedule_changed: false, reported_is_read: false } },
    build: ({ businessKey, recordedAt }) => buildPollAck(context.db, p, frame, row, members, outcome, businessKey, recordedAt) };
} };

import { candidateControlStatement, getCandidateControl } from "../../../lib/d1/notification-settings";
import { currentNotificationCandidate } from "../../../lib/d1/notification-policy";
import { NotificationError, parseControl } from "../notifications/contract";
import { controlToWire } from "../notifications/wire";
import { CommandError, invalidInput, type NormalizedCommand } from "./contract";
import type { CommandContext, CommandHandler, CommandPlan } from "./handler";
import { idValue, objectValue } from "./input";

function controlFrom(muted: unknown, until: unknown, now: Date) {
  try { return parseControl({ muted: muted as boolean, snoozedUntil: until as string | null }, now); }
  catch (error) { if (error instanceof NotificationError) throw invalidInput("until", "future_instant_required"); throw error; }
}
function normalize(context: CommandContext, request: { payload: unknown; target: unknown }): NormalizedCommand {
  const payload = objectValue(request.payload, "payload", ["candidate_id", "candidate_revision", "until", "muted"]);
  const id = idValue(payload.candidate_id, "candidate_id");
  if (typeof payload.candidate_revision !== "string") throw invalidInput("candidate_revision", "revision_required");
  if (request.target !== undefined) {
    const target = objectValue(request.target, "target", ["kind", "id"]);
    if (target.kind !== "attention_candidate" || target.id !== id) throw invalidInput("target", "candidate_mismatch");
  }
  const control = controlFrom(payload.muted === undefined ? false : payload.muted, payload.until, context.now);
  return { command: "notification.snooze", target: { kind: "attention_candidate", id }, payload: { candidate_revision: payload.candidate_revision, ...controlToWire(control) } };
}
async function plan(context: CommandContext, normalized: NormalizedCommand): Promise<CommandPlan> {
  const id = normalized.target.id;
  const candidate = await currentNotificationCandidate(context.db, context.householdId, id, context.now);
  if (!candidate) throw new CommandError("not_found");
  if (!candidate.projectionCurrent || JSON.stringify([1, id, candidate.revision]) !== normalized.payload.candidate_revision) throw new CommandError("stale_preview");
  const control = controlFrom(normalized.payload.muted, normalized.payload.until, context.now);
  const previous = await getCandidateControl(context.db, context, id);
  return {
    preview: { affected_entities: [{ kind: "attention_candidate", id }], diff: { before: { ...controlToWire(previous), revision: previous.revision }, after: controlToWire(control) }, schedule_effect: { shared_schedule_changed: false } },
    build: ({ businessKey, recordedAt }) => ({
      statements: [candidateControlStatement(context.db, context, id, control, new Date(recordedAt), previous.revision, businessKey)],
      evidence: [{ table: "notification_controls", idempotencyKey: businessKey }],
      revisionEntity: { kind: "attention_candidate", id },
      result: { candidate_id: id, ...controlToWire(control), shared_schedule_changed: false },
    }),
  };
}
export const notificationSnoozeHandler: CommandHandler = { normalize, plan };

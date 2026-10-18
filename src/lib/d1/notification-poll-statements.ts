import type { IntegrationPrincipal } from "../../features/integration/principal";
import { CommandError } from "../../features/integration/commands/contract";
import { notificationOutboxStorage as storage } from "./notification-outbox";
import { deliveryRecordStatements } from "./notification-deliveries";
import { pollClaimGuard, pollDatabaseNow, pollLeaseToken, pollMembers, pollMembershipGuard, pollPolicyGuard, type PollClaim, type PollParent, type PollSelected, type selectPollCandidates } from "./notification-poll";
import type { NotificationPolicyFrame } from "./notification-policy";
type Selection = Awaited<ReturnType<typeof selectPollCandidates>>;
const evidence = (key: string) => [{ table: "notification_poll_claims" as const, idempotencyKey: key }];
function parentGuard(db: D1Database, p: IntegrationPrincipal, entry: PollSelected, id: string, at: string) {
  const parent = entry.parent;
  return db.prepare(`INSERT INTO attention_guards(id,valid) SELECT ?1,CASE WHEN
    NOT EXISTS(SELECT 1 FROM notification_event_batches WHERE delivery_id=?2)
    AND EXISTS(SELECT 1 FROM notification_outbox WHERE delivery_id=?2 AND household_id=?3 AND user_id=?4 AND connection_id=?5
      AND candidate_id=?6 AND revision=?7 AND state IN ('pending','retry_wait') AND next_attempt_at<=?8)
    THEN 1 ELSE 0 END`).bind(id, parent?.delivery_id, p.householdId, p.userId, p.connectionId, entry.id, parent?.revision, at);
}
function selectedStatements(db: D1Database, p: IntegrationPrincipal, entry: PollSelected, claimId: string, token: string, expires: string, at: string, guards: string[]) {
  const candidate = entry.evaluation.candidate; if (!candidate) throw new Error("missing_poll_candidate");
  const deliveryId = entry.parent?.delivery_id ?? crypto.randomUUID(); const guard = crypto.randomUUID(); guards.push(guard);
  const statements = [storage.stampGuard(db, p, entry.id, entry.evaluation.stamp, guard, true)];
  if (entry.parent) {
    const unchanged = crypto.randomUUID(); guards.push(unchanged); statements.push(parentGuard(db, p, entry, unchanged, at));
    statements.push(db.prepare(`UPDATE notification_outbox SET state='sending',lease_token=?,lease_expires_at=?,attempts=attempts+1,
      first_sent_at=coalesce(first_sent_at,?),candidate_name=?,updated_at=?,revision=revision+1 WHERE delivery_id=?`)
      .bind(token, expires, at, candidate.name, at, deliveryId));
  } else statements.push(db.prepare(`INSERT INTO notification_outbox(delivery_id,household_id,user_id,connection_id,candidate_id,candidate_name,state,next_attempt_at,
    lease_token,lease_expires_at,attempts,first_sent_at,created_at,updated_at) VALUES(?,?,?,?,?,?,'sending',?,?,?,1,?,?,?)`)
    .bind(deliveryId, p.householdId, p.userId, p.connectionId, entry.id, candidate.name, at, token, expires, at, at, at));
  statements.push(db.prepare("INSERT INTO notification_poll_claim_items(claim_id,delivery_id,household_id,user_id,connection_id) VALUES(?,?,?,?,?)")
    .bind(claimId, deliveryId, p.householdId, p.userId, p.connectionId));
  return { statements, candidate: { candidate_id: entry.id, delivery_id: deliveryId, revision: JSON.stringify([1, entry.id, candidate.revision]),
    kind: candidate.kind, entity_id: candidate.entity_id, occurrence_id: candidate.occurrence_id, name: candidate.name,
    assignee_user_id: candidate.assignee_user_id, stock_status: candidate.stock_status, reason_codes: candidate.reason_codes,
    priority: candidate.priority, priority_rank: candidate.priority_rank, sort_key: candidate.sort_key, dates: candidate.dates,
    detail_url: candidate.detail_url, data_origin: candidate.data_origin } };
}
export function buildPollClaim(db: D1Database, p: IntegrationPrincipal, selection: Selection, key: string, at: string) {
  const id = `poll_${key.slice("integration:".length)}`; const token = crypto.randomUUID(); const expires = new Date(Date.parse(at) + 300_000).toISOString();
  const guards = [crypto.randomUUID()]; const empty = !selection.selected.length;
  const statements = [pollPolicyGuard(db, p, selection.frame, guards[0]),
    db.prepare(`INSERT INTO notification_poll_claims(id,household_id,user_id,connection_id,state,item_count,lease_token,lease_expires_at,idempotency_key,created_at,terminal_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(id, p.householdId, p.userId, p.connectionId, empty ? "empty" : "claimed", selection.selected.length,
      empty ? null : token, empty ? null : expires, key, at, empty ? at : null)];
  const candidates = selection.selected.map((entry) => {
    const built = selectedStatements(db, p, entry, id, token, expires, at, guards); statements.push(...built.statements); return built.candidate;
  });
  statements.push(storage.cleanupGuards(db, guards));
  return { statements, evidence: evidence(key), result: { delivery_id: empty ? null : id, lease_token: empty ? null : token, lease_expires_at: empty ? null : expires,
    candidates, skipped_reasons: selection.skipped, recheck_before_reporting: true } };
}
export async function preparePollAck(db: D1Database, p: IntegrationPrincipal, row: PollClaim, outcome: "reported" | "unknown", now: Date) {
  if (row.state !== "claimed" && row.state !== outcome) throw new CommandError("already_resolved");
  if (row.state === "claimed" && (!row.lease_expires_at || row.lease_expires_at <= now.toISOString())) throw new CommandError("already_resolved");
  const members = await pollMembers(db, p, row.id);
  if (row.state === "claimed" && (members.length !== row.item_count || members.some((m) => m.state !== "sending" || m.lease_token !== row.lease_token))) throw new CommandError("already_resolved");
  return members;
}
function liveMemberGuard(db: D1Database, p: IntegrationPrincipal, row: PollClaim, member: PollParent, id: string) {
  return db.prepare(`INSERT INTO attention_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM notification_outbox o
    WHERE delivery_id=? AND household_id=? AND user_id=? AND connection_id=? AND revision=? AND state='sending' AND lease_token=? AND lease_expires_at>${pollDatabaseNow}
      AND NOT EXISTS(SELECT 1 FROM notification_event_batches WHERE delivery_id=o.delivery_id)) THEN 1 ELSE 0 END`)
    .bind(id, member.delivery_id, p.householdId, p.userId, p.connectionId, member.revision, row.lease_token);
}
export function pollResult(row: PollClaim, members: PollParent[], outcome: "reported" | "unknown", at: string) {
  return row.result ? JSON.parse(row.result) as Record<string, unknown> : { delivery_id: row.id, outcome, reported_at: at, candidate_ids: members.map((m) => m.candidate_id).sort() };
}
export function buildPollAck(db: D1Database, p: IntegrationPrincipal, frame: NotificationPolicyFrame, row: PollClaim, members: PollParent[], outcome: "reported" | "unknown", key: string, at: string) {
  const guards = [crypto.randomUUID(), crypto.randomUUID()]; const result = pollResult(row, members, outcome, at);
  const statements = [pollPolicyGuard(db, p, frame, guards[0]), pollClaimGuard(db, p, row, guards[1])];
  if (row.state === "claimed") {
    const membership = crypto.randomUUID(); guards.push(membership);
    statements.push(pollMembershipGuard(db, row, members, membership, true));
    for (const member of members) {
      const guard = crypto.randomUUID(); guards.push(guard); statements.push(liveMemberGuard(db, p, row, member, guard));
      statements.push(storage.updateOutcome(db, { deliveryId: member.delivery_id, candidateId: member.candidate_id, leaseToken: pollLeaseToken(row) }, outcome, "periodic_report", new Date(at)),
        ...deliveryRecordStatements(db, p, { deliveryId: member.delivery_id, candidateId: member.candidate_id, outcome, reason: "periodic_report" }, member.candidate_name, new Date(at)));
    }
    statements.push(db.prepare("UPDATE notification_poll_claims SET state=?,terminal_at=?,result=? WHERE id=?").bind(outcome, at, JSON.stringify(result), row.id));
  }
  statements.push(db.prepare("UPDATE notification_poll_claims SET idempotency_key=?,revision=revision+1 WHERE id=?").bind(key, row.id), storage.cleanupGuards(db, guards));
  return { statements, evidence: evidence(key), result };
}

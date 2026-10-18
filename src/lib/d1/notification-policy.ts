import type { IntegrationPrincipal } from "../../features/integration/principal";
import { projectAttention, type AttentionSource } from "../../features/integration/attention/projection";
import { DEFAULT_SETTINGS, NotificationError, parseSettings, type NotificationSettings } from "../../features/integration/notifications/contract";
import { nextNotificationTime } from "../../features/integration/notifications/schedule";
import { getCandidateControl, NOTIFICATION_CONNECTION_ACTIVE } from "./notification-settings";
import { requireHouseholdMembership } from "./authorization";

export type NotificationDecision = { state: "ready" | "deferred" | "cancelled" | "suppressed"; reason: string; nextAt: string | null };
const decision = (state: NotificationDecision["state"], reason: string, nextAt: string | null = null): NotificationDecision => ({ state, reason, nextAt });
export type NotificationPolicyFrame = {
  owner: Pick<IntegrationPrincipal, "connectionId" | "householdId" | "userId" | "clientId">;
  epoch: string; version: number; settingsRevision: number; settings: NotificationSettings; member: boolean; usable: boolean;
};
export function assertNotificationPolicyFrame(p: IntegrationPrincipal, frame: NotificationPolicyFrame) {
  if (!p.scopes.includes("household.read") || !p.scopes.includes("events.subscribe")) throw new NotificationError("insufficient_scope");
  const owner = frame.owner;
  if (owner.connectionId !== p.connectionId || owner.householdId !== p.householdId || owner.userId !== p.userId || owner.clientId !== p.clientId) throw new NotificationError("not_found");
}
export async function readNotificationPolicyFrame(db: D1Database, p: IntegrationPrincipal, now: Date): Promise<NotificationPolicyFrame> {
  if (!p.scopes.includes("household.read") || !p.scopes.includes("events.subscribe")) throw new NotificationError("insufficient_scope");
  const row = await db.prepare(`SELECT v.epoch,v.version,s.settings,coalesce(s.revision,0) AS settings_revision,
    EXISTS(SELECT 1 FROM household_members WHERE household_id=?2 AND user_id=?3) AS member,
    EXISTS(SELECT 1 FROM oauth_connections c WHERE c.id=?1 AND c.household_id=?2 AND c.user_id=?3 AND c.client_id=?5 AND ${NOTIFICATION_CONNECTION_ACTIVE}) AS usable
    FROM household_read_versions v LEFT JOIN notification_settings s ON s.household_id=v.household_id AND s.user_id=?3
    WHERE v.household_id=?2`).bind(p.connectionId, p.householdId, p.userId, now.toISOString(), p.clientId)
    .first<{ epoch: string; version: number; settings: string | null; settings_revision: number; member: number; usable: number }>();
  if (!row) { await requireHouseholdMembership(db, { userId: p.userId }, p.householdId); throw new NotificationError("not_found"); }
  const owner = Object.freeze({ connectionId: p.connectionId, householdId: p.householdId, userId: p.userId, clientId: p.clientId });
  return Object.freeze({ owner, epoch: row.epoch, version: row.version, settingsRevision: row.settings_revision,
    settings: Object.freeze(row.settings ? parseSettings(JSON.parse(row.settings)) : { ...DEFAULT_SETTINGS }), member: row.member === 1, usable: row.usable === 1 });
}
// 共通設定より新しいcandidate stampへ差し替えない。古い設定ならbatch全体を拒否する。
export function notificationPolicyStamp<T extends { epoch: string; version: number; settings_revision: number }>(stamp: T, frame: NotificationPolicyFrame) {
  return { ...stamp, epoch: frame.epoch, version: frame.version, settings_revision: frame.settingsRevision };
}
type CandidateRow = AttentionSource & { generated_at: string; first_detected_at: string | null; eligible_on: string; payload: string; revision: number };
function projectCandidate(row: CandidateRow, now: Date) {
  const payload = projectAttention(row, now);
  if (!payload) return null;
  const eligibleSince = row.kind === "todo_occurrence" ? new Date(`${row.eligible_on}T00:00:00+09:00`).toISOString() : row.first_detected_at ?? row.generated_at;
  return { ...payload, eligibleSince, revision: row.revision, projectionCurrent: JSON.stringify(payload) === row.payload };
}
export type NotificationEvaluation = {
  candidate: ReturnType<typeof projectCandidate>; decision: NotificationDecision;
  stamp: { epoch: string; version: number; settings_revision: number; control_revision: number; candidate_revision: number };
};
export async function currentNotificationCandidate(db: D1Database, householdId: string, candidateId: string, now: Date) {
  const row = await db.prepare(`SELECT s.*,c.generated_at,c.first_detected_at,c.payload,c.revision FROM attention_candidates c JOIN attention_eligibility s
    ON s.household_id=c.household_id AND c.source_key=s.kind||':'||s.id WHERE c.id=? AND c.household_id=?`)
    .bind(candidateId, householdId).first<CandidateRow>();
  if (!row) return null;
  return projectCandidate(row, now);
}
type Previous = { count: number; lastAt: string | null; uncertain: number | null };
function repeated(settings: NotificationSettings, high: boolean, previous: Previous | undefined) {
  if (!previous?.count) return null;
  if (previous.uncertain) return { blocked: "delivery_unknown" };
  const hours = high ? settings.repeatHighHours : settings.repeatNormalHours;
  if (hours === null) return { blocked: "already_delivered" };
  if (previous.count >= 4) return { blocked: "repeat_limit" };
  return { due: new Date(Date.parse(previous.lastAt ?? "") + hours * 3_600_000) };
}
function scheduled(settings: NotificationSettings, control: { snoozedUntil: string | null }, due: Date, now: Date) {
  const until = control.snoozedUntil ? new Date(control.snoozedUntil) : due;
  const dueSince = until > due ? until : due;
  const nextAt = nextNotificationTime(settings, now, dueSince);
  if (nextAt <= now.toISOString()) return decision("ready", "eligible", nextAt);
  const reason = control.snoozedUntil !== null && until > now ? "snoozed" : "scheduled_or_quiet";
  return decision("deferred", reason, nextAt);
}
// 配信の確保ではない。#442はlease取得後・送信直前に再度呼び、同じ候補回を原子的に確保する。
export async function evaluateNotification(db: D1Database, principal: IntegrationPrincipal, candidateId: string, now: Date): Promise<NotificationDecision> {
  return evaluateNotificationWithFrame(db, principal, candidateId, now, await readNotificationPolicyFrame(db, principal, now));
}
export async function evaluateNotificationWithFrame(db: D1Database, principal: IntegrationPrincipal, candidateId: string, now: Date, frame: NotificationPolicyFrame): Promise<NotificationDecision> {
  assertNotificationPolicyFrame(principal, frame);
  if (!frame.member) await requireHouseholdMembership(db, { userId: principal.userId }, principal.householdId);
  const [control, candidate, previous] = await Promise.all([
    getCandidateControl(db, principal, candidateId), currentNotificationCandidate(db, principal.householdId, candidateId, now),
    db.prepare(`SELECT COUNT(*) AS count,MAX(recorded_at) AS lastAt,MAX(outcome='unknown') AS uncertain FROM notification_delivery_marks
      WHERE household_id=? AND user_id=? AND connection_id=? AND candidate_id=?`)
      .bind(principal.householdId, principal.userId, principal.connectionId, candidateId).first<Previous>(),
  ]);
  return candidateDecision(frame, control, candidate, previous ?? undefined, now);
}
function candidateDecision(frame: NotificationPolicyFrame, control: { muted: boolean; snoozedUntil: string | null }, candidate: ReturnType<typeof projectCandidate>, previous: Previous | undefined, now: Date) {
  if (!frame.usable) return decision("cancelled", "connection_unavailable");
  const { settings } = frame;
  if (!settings.enabled || settings.connectionId !== frame.owner.connectionId) return decision("cancelled", "disabled");
  if (settings.muted || control.muted) return decision("cancelled", "muted");
  if (!candidate) return decision("suppressed", "candidate_resolved");
  const repeat = repeated(settings, candidate.priority === "high", previous);
  if (repeat?.blocked) return decision("suppressed", repeat.blocked);
  return scheduled(settings, control, repeat?.due ?? new Date(candidate.eligibleSince), now);
}
export async function evaluateNotificationPage(db: D1Database, principal: IntegrationPrincipal, candidateIds: readonly string[], now: Date, frame: NotificationPolicyFrame): Promise<Map<string, NotificationEvaluation>> {
  assertNotificationPolicyFrame(principal, frame);
  if (!frame.member) await requireHouseholdMembership(db, { userId: principal.userId }, principal.householdId);
  const ids = [...new Set(candidateIds)]; if (ids.length > 50) throw new NotificationError("invalid_input");
  const values = JSON.stringify(ids);
  const [controls, sources, revisions, deliveries] = await Promise.all([
    db.prepare("SELECT candidate_id,muted,snoozed_until,revision FROM notification_controls WHERE household_id=? AND user_id=? AND candidate_id IN (SELECT value FROM json_each(?))")
      .bind(principal.householdId, principal.userId, values).all<{ candidate_id: string; muted: number; snoozed_until: string | null; revision: number }>(),
    db.prepare(`SELECT s.*,c.id AS candidate_id,c.generated_at,c.first_detected_at,c.payload,c.revision FROM attention_candidates c JOIN attention_eligibility s
      ON s.household_id=c.household_id AND c.source_key=s.kind||':'||s.id WHERE c.household_id=? AND c.id IN (SELECT value FROM json_each(?))`)
      .bind(principal.householdId, values).all<CandidateRow & { candidate_id: string }>(),
    db.prepare("SELECT id,revision FROM attention_candidates WHERE household_id=? AND id IN (SELECT value FROM json_each(?))")
      .bind(principal.householdId, values).all<{ id: string; revision: number }>(),
    db.prepare(`SELECT candidate_id,COUNT(*) AS count,MAX(recorded_at) AS lastAt,MAX(outcome='unknown') AS uncertain FROM notification_delivery_marks
      WHERE household_id=? AND user_id=? AND connection_id=? AND candidate_id IN (SELECT value FROM json_each(?)) GROUP BY candidate_id`)
      .bind(principal.householdId, principal.userId, principal.connectionId, values).all<Previous & { candidate_id: string }>(),
  ]);
  const controlById = new Map(controls.results.map((r) => [r.candidate_id, r]));
  const sourceById = new Map(sources.results.map((r) => [r.candidate_id, r]));
  const revisionById = new Map(revisions.results.map((r) => [r.id, r.revision]));
  const previousById = new Map(deliveries.results.map((r) => [r.candidate_id, r]));
  return new Map(ids.map((id) => {
    const row = sourceById.get(id); const control = controlById.get(id);
    const candidate = row ? projectCandidate(row, now) : null;
    const stamp = { epoch: frame.epoch, version: frame.version, settings_revision: frame.settingsRevision,
      control_revision: control?.revision ?? 0, candidate_revision: row?.revision ?? revisionById.get(id) ?? 0 };
    return [id, { candidate, stamp, decision: candidateDecision(frame, { muted: control?.muted === 1, snoozedUntil: control?.snoozed_until ?? null }, candidate, previousById.get(id), now) }];
  }));
}

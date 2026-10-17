import type { IntegrationPrincipal } from "../../features/integration/principal";
import { projectAttention, type AttentionSource } from "../../features/integration/attention/projection";
import { NotificationError, type NotificationSettings } from "../../features/integration/notifications/contract";
import { nextNotificationTime } from "../../features/integration/notifications/schedule";
import { getCandidateControl, getNotificationSettings, usableNotificationConnection } from "./notification-settings";
import { requireHouseholdMembership } from "./authorization";

export type NotificationDecision = { state: "ready" | "deferred" | "cancelled" | "suppressed"; reason: string; nextAt: string | null };
const decision = (state: NotificationDecision["state"], reason: string, nextAt: string | null = null): NotificationDecision => ({ state, reason, nextAt });
export async function currentNotificationCandidate(db: D1Database, householdId: string, candidateId: string, now: Date) {
  const row = await db.prepare(`SELECT s.*,c.generated_at,c.first_detected_at,c.payload,c.revision FROM attention_candidates c JOIN attention_eligibility s
    ON s.household_id=c.household_id AND c.source_key=s.kind||':'||s.id WHERE c.id=? AND c.household_id=?`)
    .bind(candidateId, householdId).first<AttentionSource & { generated_at: string; first_detected_at: string | null; eligible_on: string; payload: string; revision: number }>();
  if (!row) return null;
  const payload = projectAttention(row, now);
  if (!payload) return null;
  const eligibleSince = row.kind === "todo_occurrence" ? new Date(`${row.eligible_on}T00:00:00+09:00`).toISOString() : row.first_detected_at ?? row.generated_at;
  return { ...payload, eligibleSince, revision: row.revision, projectionCurrent: JSON.stringify(payload) === row.payload };
}
async function previousDeliveries(db: D1Database, principal: IntegrationPrincipal, candidateId: string) {
  return db.prepare(`SELECT COUNT(*) AS count, MAX(recorded_at) AS lastAt, MAX(outcome='unknown') AS uncertain
    FROM notification_delivery_marks WHERE household_id=? AND user_id=? AND connection_id=? AND candidate_id=?`)
    .bind(principal.householdId, principal.userId, principal.connectionId, candidateId)
    .first<{ count: number; lastAt: string | null; uncertain: number | null }>();
}
function repeated(settings: NotificationSettings, high: boolean, previous: Awaited<ReturnType<typeof previousDeliveries>>) {
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
  if (!principal.scopes.includes("household.read") || !principal.scopes.includes("events.subscribe")) throw new NotificationError("insufficient_scope");
  await requireHouseholdMembership(db, { userId: principal.userId }, principal.householdId);
  if (!await usableNotificationConnection(db, principal, principal.connectionId, now)) return decision("cancelled", "connection_unavailable");
  const { settings } = await getNotificationSettings(db, { userId: principal.userId }, principal.householdId);
  if (!settings.enabled || settings.connectionId !== principal.connectionId) return decision("cancelled", "disabled");
  const control = await getCandidateControl(db, principal, candidateId);
  if (settings.muted || control.muted) return decision("cancelled", "muted");
  const candidate = await currentNotificationCandidate(db, principal.householdId, candidateId, now);
  if (!candidate) return decision("suppressed", "candidate_resolved");
  const repeat = repeated(settings, candidate.priority === "high", await previousDeliveries(db, principal, candidateId));
  if (repeat?.blocked) return decision("suppressed", repeat.blocked);
  return scheduled(settings, control, repeat?.due ?? new Date(candidate.eligibleSince), now);
}

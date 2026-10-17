export type RecipientState = "pending" | "sending" | "retry_wait" | "accepted" | "unknown" | "failed" | "cancelled";
export type RecipientStatus = { state: RecipientState; next_attempt_at: string; reason?: string | null };
function recoveredState(state: RecipientState, mode?: "interrupted" | "cancel") {
  if (mode === "interrupted" && state === "sending") return "unknown";
  if (mode === "cancel" && (state === "pending" || state === "retry_wait")) return "cancelled";
  return state;
}
function terminalResult(states: RecipientState[], rows: RecipientStatus[], now: Date) {
  const state = states.includes("unknown") ? "unknown" : states.includes("failed") ? "failed" : states.includes("accepted") ? "accepted" : "cancelled";
  const reasons = { unknown: "recipient_result_unknown", failed: "recipient_failed", accepted: null, cancelled: "recipients_cancelled" };
  const modeChanged = state === "cancelled" && rows.every((row) => row.reason === "notification_mode_changed");
  return { state, nextAt: now.toISOString(), reason: modeChanged ? "notification_mode_changed" : reasons[state] } as const;
}
export function aggregateRecipientState(rows: RecipientStatus[], now: Date, mode?: "interrupted" | "cancel") {
  const states = rows.map((r) => recoveredState(r.state, mode));
  if (states.includes("sending")) return { state: "sending" as const, nextAt: now.toISOString(), reason: null };
  const pending = rows.filter((_r, i) => states[i] === "pending" || states[i] === "retry_wait");
  if (pending.length) return { state: "retry_wait" as const, nextAt: pending.map((r) => r.next_attempt_at).sort()[0], reason: "recipients_pending" };
  return terminalResult(states, rows, now);
}
export async function eventRecipientStatuses(db: D1Database, deliveryId: string) {
  return (await db.prepare("SELECT state,next_attempt_at,reason FROM notification_event_recipients WHERE delivery_id=? ORDER BY subscription_id").bind(deliveryId).all<RecipientStatus>()).results;
}

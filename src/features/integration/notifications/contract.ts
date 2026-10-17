import { Temporal } from "@js-temporal/polyfill";

export type NotificationSettings = {
  enabled: boolean; connectionId: string | null; muted: boolean;
  timeZone: string; mode: "daily" | "individual"; digestTime: string;
  quietEnabled: boolean; quietStart: string; quietEnd: string;
  repeatHighHours: number | null; repeatNormalHours: number | null;
};
export const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: false, connectionId: null, muted: false, timeZone: "Asia/Tokyo",
  mode: "daily", digestTime: "09:00", quietEnabled: true, quietStart: "22:00", quietEnd: "08:00",
  repeatHighHours: null, repeatNormalHours: null,
};
export class NotificationError extends Error {
  constructor(public readonly code: "invalid_input" | "not_found" | "stale_settings" | "connection_unavailable" | "insufficient_scope") { super(code); }
}
function time(value: unknown): string {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new NotificationError("invalid_input");
  return value;
}
function flag(value: unknown): boolean {
  if (typeof value !== "boolean") throw new NotificationError("invalid_input");
  return value;
}
function repeat(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 24 || value > 720) throw new NotificationError("invalid_input");
  return value;
}
function zone(value: unknown): string {
  if (typeof value !== "string" || value.length > 100) throw new NotificationError("invalid_input");
  try { return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone; }
  catch { throw new NotificationError("invalid_input"); }
}
export function parseSettings(input: unknown): NotificationSettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new NotificationError("invalid_input");
  const p = input as Record<string, unknown>;
  if (p.mode !== "daily" && p.mode !== "individual") throw new NotificationError("invalid_input");
  if (p.connectionId !== null && (typeof p.connectionId !== "string" || !p.connectionId || p.connectionId.length > 200)) throw new NotificationError("invalid_input");
  const result: NotificationSettings = {
    enabled: flag(p.enabled), connectionId: p.connectionId, muted: flag(p.muted),
    timeZone: zone(p.timeZone), mode: p.mode, digestTime: time(p.digestTime), quietEnabled: flag(p.quietEnabled),
    quietStart: time(p.quietStart), quietEnd: time(p.quietEnd),
    repeatHighHours: repeat(p.repeatHighHours), repeatNormalHours: repeat(p.repeatNormalHours),
  };
  if (result.quietEnabled && result.quietStart === result.quietEnd) throw new NotificationError("invalid_input");
  if (result.enabled && !result.connectionId) throw new NotificationError("invalid_input");
  return result;
}
export type CandidateControl = { muted: boolean; snoozedUntil: string | null };
export function parseControl(input: CandidateControl, now: Date): CandidateControl {
  const muted = flag(input.muted);
  if (input.snoozedUntil === null) return { muted, snoozedUntil: null };
  if (typeof input.snoozedUntil !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(input.snoozedUntil)) throw new NotificationError("invalid_input");
  let until: Date;
  try { until = new Date(Temporal.Instant.from(input.snoozedUntil).epochMilliseconds); }
  catch { throw new NotificationError("invalid_input"); }
  if (!Number.isFinite(until.getTime()) || until <= now || until.getTime() > now.getTime() + 366 * 86_400_000) throw new NotificationError("invalid_input");
  return { muted, snoozedUntil: until.toISOString() };
}

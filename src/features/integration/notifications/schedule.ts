import { Temporal } from "@js-temporal/polyfill";
import type { NotificationSettings } from "./contract";

// 重複時刻は最初の一回。存在しない時刻は、ずらした同分ではなく遷移直後。
export function localNotificationTime(date: string, time: string, timeZone: string): string {
  const plain = Temporal.PlainDateTime.from(`${date}T${time}`);
  const early = plain.toZonedDateTime(timeZone, { disambiguation: "earlier" });
  const resolved = early.toPlainDateTime().equals(plain) ? early : early.getTimeZoneTransition("next");
  if (!resolved) throw new Error("Missing time zone transition");
  return new Date(resolved.epochMilliseconds).toISOString();
}
function local(instant: Date, zone: string) {
  return Temporal.Instant.fromEpochMilliseconds(instant.getTime()).toZonedDateTimeISO(zone);
}
function digestSlot(settings: NotificationSettings, due: Date): Date {
  if (settings.mode === "individual") return due;
  const date = local(due, settings.timeZone).toPlainDate();
  const slot = new Date(localNotificationTime(date.toString(), settings.digestTime, settings.timeZone));
  return slot >= due ? slot : new Date(localNotificationTime(date.add({ days: 1 }).toString(), settings.digestTime, settings.timeZone));
}
export function quietHoursEnd(settings: NotificationSettings, at: Date): Date {
  if (!settings.quietEnabled) return at;
  const zoned = local(at, settings.timeZone);
  const time = zoned.toPlainTime().toString({ smallestUnit: "minute" });
  const { quietStart: start, quietEnd: end } = settings;
  const overnight = start > end;
  const quiet = overnight ? time >= start || time < end : time >= start && time < end;
  if (!quiet) return at;
  const date = zoned.toPlainDate().add({ days: overnight && time >= start ? 1 : 0 });
  let stop = new Date(localNotificationTime(date.toString(), end, settings.timeZone));
  // DSTの二度目の休止区間内なら、二度目の終了まで待つ。
  if (stop <= at) stop = new Date(Temporal.PlainDateTime.from(`${date.toString()}T${end}`).toZonedDateTime(settings.timeZone, { disambiguation: "later" }).epochMilliseconds);
  return stop;
}
export function nextNotificationTime(settings: NotificationSettings, now: Date, dueSince: Date): string {
  const slot = digestSlot(settings, dueSince);
  return quietHoursEnd(settings, slot > now ? slot : now).toISOString();
}
export function nextAllowedNotificationTime(settings: NotificationSettings, connectionActive: boolean, now: Date): string | null {
  return settings.enabled && !settings.muted && connectionActive ? nextNotificationTime(settings, now, now) : null;
}
export function tomorrowNotificationTime(settings: NotificationSettings, now: Date): string {
  const date = local(now, settings.timeZone).toPlainDate().add({ days: 1 });
  return localNotificationTime(date.toString(), settings.digestTime, settings.timeZone);
}

import { getNotificationSettings, notificationSettingsStatement, usableNotificationConnection } from "../../../lib/d1/notification-settings";
import { parseSettings, NotificationError } from "../notifications/contract";
import { nextNotificationTime } from "../notifications/schedule";
import { settingsToWire } from "../notifications/wire";
import { CommandError, invalidInput, type NormalizedCommand } from "./contract";
import type { CommandContext, CommandHandler, CommandPlan } from "./handler";
import { objectValue } from "./input";

const FIELDS = ["settings_revision", "enabled", "connection_id", "time_zone", "mode", "digest_time", "quiet_hours", "repeat_policy", "muted"];
function normalize(context: CommandContext, request: { payload: unknown; target: unknown }): NormalizedCommand {
  const payload = objectValue(request.payload, "payload", FIELDS);
  if (!Number.isSafeInteger(payload.settings_revision) || Number(payload.settings_revision) < 0) throw invalidInput("settings_revision", "revision_required");
  if (request.target !== undefined) {
    const target = objectValue(request.target, "target", ["kind", "id"]);
    if (target.kind !== "notification_settings" || target.id !== context.userId) throw new CommandError("not_found");
  }
  return { command: "notification.configure", target: { kind: "notification_settings", id: context.userId }, payload: { ...payload, reference_at: context.now.toISOString() } };
}
function fieldsFrom(values: Record<string, unknown>, mapping: Record<string, string>) {
  return Object.fromEntries(Object.entries(mapping).filter(([key]) => key in values).map(([key, field]) => [field, values[key]]));
}
function updatedSettings(current: Awaited<ReturnType<typeof getNotificationSettings>>, payload: Record<string, unknown>) {
  const quiet = payload.quiet_hours === undefined ? {} : objectValue(payload.quiet_hours, "quiet_hours", ["enabled", "start", "end"]);
  const repeats = payload.repeat_policy === undefined ? {} : objectValue(payload.repeat_policy, "repeat_policy", ["high_hours", "normal_hours"]);
  const mapping = { enabled: "enabled", connection_id: "connectionId", time_zone: "timeZone", mode: "mode", digest_time: "digestTime", muted: "muted" } as const;
  const patch = { ...fieldsFrom(payload, mapping), ...fieldsFrom(quiet, { enabled: "quietEnabled", start: "quietStart", end: "quietEnd" }), ...fieldsFrom(repeats, { high_hours: "repeatHighHours", normal_hours: "repeatNormalHours" }) };
  try { return parseSettings({ ...current.settings, ...patch }); }
  catch (error) { if (error instanceof NotificationError) throw invalidInput("payload", "invalid_notification_settings"); throw error; }
}
async function plan(context: CommandContext, normalized: NormalizedCommand): Promise<CommandPlan> {
  const current = await getNotificationSettings(context.db, { userId: context.userId }, context.householdId);
  if (current.revision !== normalized.payload.settings_revision) throw new CommandError("stale_preview");
  const settings = updatedSettings(current, normalized.payload);
  if (settings.enabled && (!settings.connectionId || !await usableNotificationConnection(context.db, context, settings.connectionId, context.now))) throw invalidInput("connection_id", "notification_connection_unavailable");
  const reference = new Date(String(normalized.payload.reference_at));
  const nextAt = nextNotificationTime(settings, reference, reference);
  return {
    preview: { affected_entities: [{ kind: "notification_settings", id: context.userId }], diff: { before: settingsToWire(current.settings), after: settingsToWire(settings), settings_revision: current.revision }, schedule_effect: { shared_schedule_changed: false, next_allowed_at: nextAt } },
    build: ({ businessKey, recordedAt }) => ({
      statements: [notificationSettingsStatement(context.db, context, settings, current.revision, new Date(recordedAt), businessKey)],
      evidence: [{ table: "notification_settings", idempotencyKey: businessKey }],
      revisionEntity: { kind: "notification_settings", id: context.userId },
      result: { settings: settingsToWire(settings), settings_revision: current.revision + 1, next_allowed_at: nextAt, shared_schedule_changed: false },
    }),
  };
}
export const notificationConfigureHandler: CommandHandler = { normalize, plan };

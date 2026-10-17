import type { DeliveryHistory } from "../../../lib/d1/notification-deliveries";
import type { CandidateControl, NotificationSettings } from "./contract";

export function settingsToWire(settings: NotificationSettings) {
  return { enabled: settings.enabled, connection_id: settings.connectionId, muted: settings.muted,
    time_zone: settings.timeZone, mode: settings.mode, digest_time: settings.digestTime,
    quiet_hours: { enabled: settings.quietEnabled, start: settings.quietStart, end: settings.quietEnd },
    repeat_policy: { high_hours: settings.repeatHighHours, normal_hours: settings.repeatNormalHours } };
}
export function controlToWire(control: CandidateControl) {
  return { muted: control.muted, until: control.snoozedUntil };
}
export function deliveryToWire(delivery: DeliveryHistory) {
  return { delivery_id: delivery.deliveryId, candidate_id: delivery.candidateId, candidate_name: delivery.candidateName,
    connection_id: delivery.connectionId, outcome: delivery.outcome, reason: delivery.reason, recorded_at: delivery.recordedAt,
    data_origin: "user_authored" as const };
}

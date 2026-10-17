import type { DeliveryOutcome } from "../../../lib/d1/notification-deliveries";
export const DELIVERY_LABELS: Record<DeliveryOutcome, string> = {
  accepted: "連携先がイベントを受領", reported: "連携先が案内したと報告", unknown: "送信結果が不明", failed: "送信に失敗",
  deferred: "後で知らせる", cancelled: "配信を取りやめ", suppressed: "対象外のため見送り",
};
export const REASON_LABELS: Record<string, string> = {
  snoozed: "指定した時刻まで通知を休止中", scheduled_or_quiet: "通知時刻の前、または静かな時間", muted: "本人が通知を休止中",
  disabled: "通知が無効、または通知先が変更済み", connection_unavailable: "連携が解除・失効したか、必要な許可がありません",
  candidate_resolved: "用事が完了したか、通知の条件が解消済み", already_delivered: "すでに案内用の通知を送信済み",
  delivery_unknown: "前回の送信結果を確認できないため、自動再送を停止", repeat_limit: "再通知の上限に到達", eligible: "配信可能",
};

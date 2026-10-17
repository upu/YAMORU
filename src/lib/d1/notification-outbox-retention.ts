export async function pruneNotificationOutbox(db: D1Database, now: Date) {
  const cutoff = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  await db.batch([
    db.prepare(`UPDATE notification_event_batches SET body=NULL WHERE delivery_id IN (
      SELECT b.delivery_id FROM notification_event_batches b JOIN notification_outbox o ON o.delivery_id=b.delivery_id
      WHERE o.state IN ('accepted','reported','unknown','failed','cancelled','suppressed') AND o.updated_at<? AND b.body IS NOT NULL
      ORDER BY o.updated_at,b.delivery_id LIMIT 100)`).bind(cutoff),
    db.prepare(`DELETE FROM notification_outbox_sources WHERE delivery_id IN (
      SELECT delivery_id FROM notification_outbox_sources WHERE terminal_at IS NOT NULL AND terminal_at<?
      ORDER BY terminal_at,delivery_id LIMIT 100)`).bind(cutoff),
    db.prepare(`UPDATE notification_outbox SET candidate_name='',revision=revision+1 WHERE delivery_id IN (
      SELECT delivery_id FROM notification_outbox WHERE state IN ('unknown','failed') AND updated_at<? AND candidate_name<>''
      ORDER BY updated_at,delivery_id LIMIT 100)`).bind(cutoff),
    db.prepare(`DELETE FROM notification_outbox WHERE delivery_id IN (
      SELECT delivery_id FROM notification_outbox WHERE state IN ('accepted','reported','cancelled','suppressed') AND updated_at<?
      ORDER BY updated_at,delivery_id LIMIT 100)`).bind(cutoff),
  ]);
}

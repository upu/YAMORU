-- 本文破棄後も残す証拠を、以降の清掃で読み直さない。
ALTER TABLE notification_event_batches ADD COLUMN terminal_at TEXT;
UPDATE notification_event_batches SET terminal_at=(SELECT updated_at FROM notification_outbox o
  WHERE o.delivery_id=notification_event_batches.delivery_id AND o.state IN ('accepted','reported','unknown','failed','cancelled','suppressed'));
CREATE INDEX notification_event_batches_retention_idx ON notification_event_batches(terminal_at,delivery_id)
  WHERE terminal_at IS NOT NULL AND body IS NOT NULL;
CREATE TRIGGER notification_event_batch_terminal_insert AFTER INSERT ON notification_event_batches BEGIN
  UPDATE notification_event_batches SET terminal_at=(SELECT updated_at FROM notification_outbox o
    WHERE o.delivery_id=NEW.delivery_id AND o.state IN ('accepted','reported','unknown','failed','cancelled','suppressed')) WHERE delivery_id=NEW.delivery_id;
END;
CREATE TRIGGER notification_event_batch_terminal_update AFTER UPDATE OF state,updated_at ON notification_outbox BEGIN
  UPDATE notification_event_batches SET terminal_at = CASE
    WHEN NEW.state IN ('accepted','reported','unknown','failed','cancelled','suppressed') THEN NEW.updated_at ELSE NULL END WHERE delivery_id=NEW.delivery_id;
END;

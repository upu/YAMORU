-- 元の対象を候補とは独立して保持する。既存ID・日時・旧WorkerのINSERTは維持する。
CREATE UNIQUE INDEX notification_outbox_owner_id_idx ON notification_outbox(delivery_id,household_id,user_id,connection_id);
CREATE INDEX notification_outbox_retention_idx ON notification_outbox(updated_at,delivery_id) WHERE state IN ('accepted','reported','cancelled','suppressed');
CREATE INDEX notification_outbox_redaction_idx ON notification_outbox(updated_at,delivery_id) WHERE state IN ('unknown','failed') AND candidate_name<>'';
CREATE TABLE notification_outbox_sources (
  delivery_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('todo_occurrence','consumable')),
  entity_id TEXT NOT NULL,
  todo_rule_id TEXT,
  created_at TEXT NOT NULL,
  terminal_at TEXT,
  FOREIGN KEY(delivery_id,household_id,user_id,connection_id)
    REFERENCES notification_outbox(delivery_id,household_id,user_id,connection_id) ON DELETE CASCADE,
  CHECK((kind='todo_occurrence')=(todo_rule_id IS NOT NULL))
);
CREATE INDEX notification_outbox_sources_retention_idx ON notification_outbox_sources(terminal_at,delivery_id) WHERE terminal_at IS NOT NULL;
INSERT INTO notification_outbox_sources(delivery_id,household_id,user_id,connection_id,kind,entity_id,todo_rule_id,created_at,terminal_at)
SELECT o.delivery_id,o.household_id,o.user_id,o.connection_id,json_extract(c.payload,'$.kind'),json_extract(c.payload,'$.entity_id'),t.task_rule_id,o.created_at,
  CASE WHEN o.state IN ('accepted','reported','unknown','failed','cancelled','suppressed') THEN o.updated_at ELSE NULL END
FROM notification_outbox o JOIN attention_candidates c ON c.id=o.candidate_id AND c.household_id=o.household_id
LEFT JOIN task_occurrences t ON t.id=json_extract(c.payload,'$.entity_id') AND t.household_id=o.household_id AND json_extract(c.payload,'$.kind')='todo_occurrence'
LEFT JOIN consumables s ON s.id=json_extract(c.payload,'$.entity_id') AND s.household_id=o.household_id AND json_extract(c.payload,'$.kind')='consumable'
WHERE t.id IS NOT NULL OR s.id IS NOT NULL;
CREATE TRIGGER notification_outbox_capture_source AFTER INSERT ON notification_outbox BEGIN
  INSERT INTO notification_outbox_sources(delivery_id,household_id,user_id,connection_id,kind,entity_id,todo_rule_id,created_at,terminal_at)
  SELECT NEW.delivery_id,NEW.household_id,NEW.user_id,NEW.connection_id,json_extract(c.payload,'$.kind'),json_extract(c.payload,'$.entity_id'),t.task_rule_id,NEW.created_at,
    CASE WHEN NEW.state IN ('accepted','reported','unknown','failed','cancelled','suppressed') THEN NEW.updated_at ELSE NULL END
  FROM attention_candidates c
  LEFT JOIN task_occurrences t ON t.id=json_extract(c.payload,'$.entity_id') AND t.household_id=NEW.household_id AND json_extract(c.payload,'$.kind')='todo_occurrence'
  LEFT JOIN consumables s ON s.id=json_extract(c.payload,'$.entity_id') AND s.household_id=NEW.household_id AND json_extract(c.payload,'$.kind')='consumable'
  WHERE c.id=NEW.candidate_id AND c.household_id=NEW.household_id AND (t.id IS NOT NULL OR s.id IS NOT NULL);
END;
CREATE TRIGGER notification_outbox_source_retention AFTER UPDATE OF state,updated_at ON notification_outbox BEGIN
  UPDATE notification_outbox_sources SET terminal_at = CASE
    WHEN NEW.state IN ('accepted','reported','unknown','failed','cancelled','suppressed') THEN NEW.updated_at ELSE NULL END
    WHERE delivery_id=NEW.delivery_id;
END;

-- 旧Workerの購読INSERT/UPDATEでも、停止・失効を越えた新しい購読を区別する。
ALTER TABLE notification_event_subscriptions ADD COLUMN lifecycle TEXT NOT NULL DEFAULT '' CHECK(length(lifecycle) IN (0,32));
UPDATE notification_event_subscriptions SET lifecycle=lower(hex(randomblob(16)));
CREATE TRIGGER notification_subscription_lifecycle_insert AFTER INSERT ON notification_event_subscriptions BEGIN
  UPDATE notification_event_subscriptions SET lifecycle=lower(hex(randomblob(16))) WHERE id=NEW.id;
END;
CREATE TRIGGER notification_subscription_lifecycle_restart AFTER UPDATE OF state,expires_at ON notification_event_subscriptions
WHEN NEW.state='active' AND (OLD.state<>'active' OR OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')) BEGIN
  UPDATE notification_event_subscriptions SET lifecycle=lower(hex(randomblob(16))) WHERE id=NEW.id;
END;

CREATE TABLE notification_event_batches (
  delivery_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  body TEXT CHECK(body IS NULL OR (json_valid(body) AND length(CAST(body AS BLOB))<=262144)),
  frozen_at TEXT NOT NULL,
  FOREIGN KEY(delivery_id,household_id,user_id,connection_id)
    REFERENCES notification_outbox(delivery_id,household_id,user_id,connection_id) ON DELETE CASCADE,
  UNIQUE(delivery_id,household_id,user_id,connection_id)
);
CREATE TABLE notification_event_recipients (
  delivery_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  lifecycle TEXT NOT NULL CHECK(length(lifecycle)=32),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','retry_wait','accepted','unknown','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 8),
  attempt_token TEXT,
  next_attempt_at TEXT NOT NULL,
  first_sent_at TEXT,
  updated_at TEXT NOT NULL,
  reason TEXT,
  PRIMARY KEY(delivery_id,subscription_id),
  FOREIGN KEY(delivery_id,household_id,user_id,connection_id)
    REFERENCES notification_event_batches(delivery_id,household_id,user_id,connection_id) ON DELETE CASCADE,
  CHECK((state='sending')=(attempt_token IS NOT NULL))
);
-- 購読の清掃で送信証拠を消さない。INSERT時だけ現在の購読との家庭・本人一致を強制する。
CREATE TRIGGER notification_recipient_owner BEFORE INSERT ON notification_event_recipients
WHEN NOT EXISTS(SELECT 1 FROM notification_event_subscriptions s WHERE s.id=NEW.subscription_id
    AND s.household_id=NEW.household_id AND s.user_id=NEW.user_id AND s.connection_id=NEW.connection_id AND s.lifecycle=NEW.lifecycle)
BEGIN
  SELECT RAISE(ABORT,'recipient owner mismatch');
END;
CREATE TRIGGER notification_recipient_identity BEFORE UPDATE OF delivery_id,household_id,user_id,connection_id,subscription_id,lifecycle ON notification_event_recipients
WHEN NEW.delivery_id<>OLD.delivery_id OR NEW.household_id<>OLD.household_id OR NEW.user_id<>OLD.user_id OR NEW.connection_id<>OLD.connection_id
  OR NEW.subscription_id<>OLD.subscription_id OR NEW.lifecycle<>OLD.lifecycle BEGIN
  SELECT RAISE(ABORT,'recipient identity is immutable');
END;

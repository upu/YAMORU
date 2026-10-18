-- 日次まとめの本文と、既存の宛先別結果を結ぶ。旧表・旧SQLは置換しない。
CREATE UNIQUE INDEX notification_recipient_identity_idx ON notification_event_recipients
  (delivery_id,subscription_id,household_id,user_id,connection_id,lifecycle);

CREATE TABLE notification_event_groups (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  lifecycle TEXT NOT NULL CHECK(length(lifecycle)=32),
  event_id TEXT NOT NULL UNIQUE,
  body TEXT CHECK(body IS NULL OR (json_valid(body) AND length(CAST(body AS BLOB))<=262144)),
  item_count INTEGER NOT NULL CHECK(item_count BETWEEN 1 AND 50),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','retry_wait','accepted','unknown','failed','cancelled')),
  attempt_token TEXT,
  attempt_expires_at TEXT,
  next_attempt_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  frozen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  terminal_at TEXT,
  reason TEXT,
  FOREIGN KEY(connection_id,household_id,user_id) REFERENCES oauth_connections(id,household_id,user_id) ON DELETE CASCADE,
  UNIQUE(id,subscription_id,household_id,user_id,connection_id,lifecycle),
  CHECK((state='sending')=(attempt_token IS NOT NULL)),
  CHECK((state='sending')=(attempt_expires_at IS NOT NULL)),
  CHECK((state IN ('accepted','unknown','failed','cancelled'))=(terminal_at IS NOT NULL)),
  CHECK(body IS NOT NULL OR terminal_at IS NOT NULL)
);
CREATE INDEX notification_event_groups_ready_idx ON notification_event_groups(connection_id,next_attempt_at,id)
  WHERE state IN ('pending','retry_wait');
CREATE INDEX notification_event_groups_recovery_idx ON notification_event_groups(connection_id,attempt_expires_at,id)
  WHERE state='sending';
CREATE INDEX notification_event_groups_retention_idx ON notification_event_groups(terminal_at,id)
  WHERE terminal_at IS NOT NULL AND body IS NOT NULL;
CREATE INDEX notification_event_groups_prune_idx ON notification_event_groups(terminal_at,id)
  WHERE state IN ('accepted','cancelled');
CREATE TRIGGER notification_event_group_owner BEFORE INSERT ON notification_event_groups
WHEN NOT EXISTS(SELECT 1 FROM notification_event_subscriptions s WHERE s.id=NEW.subscription_id
  AND s.household_id=NEW.household_id AND s.user_id=NEW.user_id AND s.connection_id=NEW.connection_id AND s.lifecycle=NEW.lifecycle)
BEGIN
  SELECT RAISE(ABORT,'event group owner mismatch');
END;
CREATE TRIGGER notification_event_group_identity BEFORE UPDATE OF id,household_id,user_id,connection_id,subscription_id,lifecycle,event_id,item_count,frozen_at,body ON notification_event_groups
WHEN NEW.id<>OLD.id OR NEW.household_id<>OLD.household_id OR NEW.user_id<>OLD.user_id OR NEW.connection_id<>OLD.connection_id
  OR NEW.subscription_id<>OLD.subscription_id OR NEW.lifecycle<>OLD.lifecycle OR NEW.event_id<>OLD.event_id
  OR NEW.item_count<>OLD.item_count OR NEW.frozen_at<>OLD.frozen_at
  OR (NEW.body IS NOT OLD.body AND NOT(OLD.body IS NOT NULL AND NEW.body IS NULL AND NEW.terminal_at IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT,'event group identity is immutable');
END;

-- 生存購読へのFKを置かず、購読清掃後も本文と所属の証拠を保持する。
CREATE TABLE notification_event_group_items (
  group_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  PRIMARY KEY(group_id,delivery_id,subscription_id),
  FOREIGN KEY(group_id,subscription_id,household_id,user_id,connection_id,lifecycle)
    REFERENCES notification_event_groups(id,subscription_id,household_id,user_id,connection_id,lifecycle) ON DELETE CASCADE,
  FOREIGN KEY(delivery_id,subscription_id,household_id,user_id,connection_id,lifecycle)
    REFERENCES notification_event_recipients(delivery_id,subscription_id,household_id,user_id,connection_id,lifecycle) ON DELETE CASCADE
);
CREATE INDEX notification_event_group_items_recipient_idx ON notification_event_group_items(delivery_id,subscription_id);
CREATE TRIGGER notification_event_group_item_identity BEFORE UPDATE ON notification_event_group_items BEGIN
  SELECT RAISE(ABORT,'event group item is immutable');
END;

-- 確保だけを解放して再編成できる。過去の所属行と宛先別の回数・結果は消さない。
CREATE TABLE notification_event_group_claims (
  delivery_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  PRIMARY KEY(delivery_id,subscription_id),
  FOREIGN KEY(group_id,delivery_id,subscription_id)
    REFERENCES notification_event_group_items(group_id,delivery_id,subscription_id) ON DELETE CASCADE
);
CREATE INDEX notification_event_group_claims_group_idx ON notification_event_group_claims(group_id,delivery_id,subscription_id);
CREATE TRIGGER notification_event_group_claim_identity BEFORE UPDATE ON notification_event_group_claims BEGIN
  SELECT RAISE(ABORT,'event group claim is immutable');
END;

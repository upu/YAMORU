-- #442: 検証済み購読を追加。既存の業務データ・outbox・旧WorkerのSQLは不変。
CREATE TABLE notification_event_subscriptions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  event_name TEXT NOT NULL CHECK(event_name='attention.ready'),
  filters TEXT NOT NULL CHECK(json_valid(filters) AND json_type(filters)='object' AND length(filters)<=24000),
  callback_origin TEXT NOT NULL CHECK(length(callback_origin)<=300),
  callback_hash TEXT NOT NULL CHECK(length(callback_hash)=64),
  key_fingerprint TEXT CHECK(length(key_fingerprint)=64),
  provider_id TEXT CHECK(length(provider_id) BETWEEN 1 AND 100),
  encrypted_destination TEXT CHECK(encrypted_destination IS NULL OR (length(encrypted_destination) BETWEEN 1 AND 8192 AND substr(encrypted_destination,1,3)='v1.')),
  state TEXT NOT NULL CHECK(state IN ('active','revoked','expired')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  verified_at TEXT,
  expires_at TEXT NOT NULL,
  stopped_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(connection_id,household_id,user_id) REFERENCES oauth_connections(id,household_id,user_id) ON DELETE CASCADE,
  CHECK((state='active')=(encrypted_destination IS NOT NULL)),
  CHECK((state='active')=(stopped_at IS NULL)),
  CHECK(state<>'active' OR (key_fingerprint IS NOT NULL AND provider_id IS NOT NULL AND verified_at IS NOT NULL AND expires_at>verified_at))
);
CREATE INDEX notification_subscriptions_owner_idx ON notification_event_subscriptions(connection_id,state,expires_at);
CREATE INDEX notification_subscriptions_verification_idx ON notification_event_subscriptions(connection_id,callback_hash,key_fingerprint,provider_id,verified_at);
CREATE INDEX notification_subscriptions_retention_idx ON notification_event_subscriptions(state,updated_at);

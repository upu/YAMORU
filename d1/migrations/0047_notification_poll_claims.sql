CREATE TABLE notification_poll_claims (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('claimed','reported','unknown','empty')),
  item_count INTEGER NOT NULL CHECK(item_count BETWEEN 0 AND 50),
  lease_token TEXT,
  lease_expires_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  terminal_at TEXT,
  result TEXT CHECK(result IS NULL OR json_valid(result)),
  UNIQUE(id,household_id,user_id,connection_id),
  FOREIGN KEY(connection_id,household_id,user_id) REFERENCES oauth_connections(id,household_id,user_id) ON DELETE CASCADE,
  CHECK((state='empty')=(item_count=0)),
  CHECK((state='empty')=(lease_token IS NULL)),
  CHECK((lease_token IS NULL)=(lease_expires_at IS NULL)),
  CHECK(lease_expires_at IS NULL OR lease_expires_at>created_at),
  CHECK((state='claimed')=(terminal_at IS NULL)),
  CHECK((state IN ('reported','unknown'))=(result IS NOT NULL))
);
CREATE TABLE notification_poll_claim_items (
  claim_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL UNIQUE,
  household_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  PRIMARY KEY(claim_id,delivery_id),
  FOREIGN KEY(claim_id,household_id,user_id,connection_id) REFERENCES notification_poll_claims(id,household_id,user_id,connection_id) ON DELETE CASCADE,
  FOREIGN KEY(delivery_id,household_id,user_id,connection_id) REFERENCES notification_outbox(delivery_id,household_id,user_id,connection_id) ON DELETE CASCADE
);
CREATE INDEX notification_poll_claims_expired_idx ON notification_poll_claims(connection_id,lease_expires_at,id) WHERE state='claimed';
CREATE INDEX notification_poll_claims_retention_idx ON notification_poll_claims(terminal_at,id) WHERE terminal_at IS NOT NULL;

-- #442: 個人の配信試行を追加する。既存の業務行・日時・旧WorkerのSQLは不変。
CREATE TABLE notification_outbox (
  delivery_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  candidate_name TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','leased','sending','retry_wait','accepted','reported','unknown','failed','cancelled','suppressed')),
  next_attempt_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 8),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  lease_token TEXT,
  lease_expires_at TEXT,
  first_sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reason TEXT,
  FOREIGN KEY(connection_id,household_id,user_id) REFERENCES oauth_connections(id,household_id,user_id) ON DELETE CASCADE,
  CHECK((lease_token IS NULL)=(lease_expires_at IS NULL)),
  CHECK((state IN ('leased','sending'))=(lease_token IS NOT NULL))
);
-- 候補を解消しても送信中・不明の証拠は消さない。失敗の上限を新しいIDで回避しない。
CREATE UNIQUE INDEX notification_outbox_active_candidate_idx
  ON notification_outbox(household_id,user_id,connection_id,candidate_id)
  WHERE state IN ('pending','leased','sending','retry_wait','unknown','failed');
CREATE INDEX notification_outbox_due_idx ON notification_outbox(connection_id,state,next_attempt_at,delivery_id);
CREATE INDEX notification_outbox_expired_idx ON notification_outbox(state,lease_expires_at);

CREATE TABLE notification_scheduler_progress (
  connection_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source_epoch TEXT NOT NULL DEFAULT '',
  source_version INTEGER NOT NULL DEFAULT -1,
  source_day TEXT NOT NULL DEFAULT '',
  source_after TEXT NOT NULL DEFAULT '',
  candidate_after TEXT NOT NULL DEFAULT '',
  outbox_after TEXT NOT NULL DEFAULT '',
  next_run_at TEXT NOT NULL,
  lease_token TEXT,
  lease_expires_at TEXT,
  last_success_at TEXT,
  last_error TEXT CHECK(last_error IN ('conflict','unavailable')),
  FOREIGN KEY(connection_id,household_id,user_id) REFERENCES oauth_connections(id,household_id,user_id) ON DELETE CASCADE,
  CHECK((lease_token IS NULL)=(lease_expires_at IS NULL))
);
CREATE INDEX notification_scheduler_due_idx ON notification_scheduler_progress(next_run_at,connection_id);
CREATE INDEX notification_scheduler_household_idx ON notification_scheduler_progress(household_id);

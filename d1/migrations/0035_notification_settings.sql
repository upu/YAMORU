-- #441 / YDR-056: 追加のみ。共有予定・元の日時・旧Workerの書き込みは不変。
CREATE UNIQUE INDEX oauth_connections_person_idx ON oauth_connections(id, household_id, user_id);
CREATE UNIQUE INDEX attention_candidates_household_idx ON attention_candidates(id, household_id);

CREATE TABLE notification_settings (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id TEXT,
  settings TEXT NOT NULL CHECK(json_valid(settings)),
  revision INTEGER NOT NULL CHECK(revision > 0),
  updated_at TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  PRIMARY KEY(household_id,user_id),
  FOREIGN KEY(connection_id,household_id,user_id) REFERENCES oauth_connections(id,household_id,user_id) ON DELETE CASCADE
);
CREATE TABLE notification_controls (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL,
  muted INTEGER NOT NULL CHECK(muted IN (0,1)),
  snoozed_until TEXT,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT UNIQUE,
  PRIMARY KEY(household_id,user_id,candidate_id),
  FOREIGN KEY(candidate_id,household_id) REFERENCES attention_candidates(id,household_id) ON DELETE CASCADE
);
-- 配信の最小記録。候補区間が続く間は履歴詳細の削除後も重複を抑止する。
CREATE TABLE notification_delivery_marks (
  delivery_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('accepted','reported','unknown')),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY(delivery_id,candidate_id),
  FOREIGN KEY(connection_id,household_id,user_id) REFERENCES oauth_connections(id,household_id,user_id) ON DELETE CASCADE,
  FOREIGN KEY(candidate_id,household_id) REFERENCES attention_candidates(id,household_id) ON DELETE CASCADE
);
CREATE INDEX notification_marks_candidate_idx ON notification_delivery_marks(household_id,user_id,connection_id,candidate_id,recorded_at);
-- 候補の削除後も本人が経緯を確認できる。outbox/leaseは#442が追加する。
CREATE TABLE notification_delivery_history (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  candidate_name TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('accepted','reported','unknown','failed','deferred','cancelled','suppressed')),
  reason TEXT,
  recorded_at TEXT NOT NULL,
  UNIQUE(delivery_id,candidate_id),
  FOREIGN KEY(connection_id,household_id,user_id) REFERENCES oauth_connections(id,household_id,user_id) ON DELETE CASCADE
);
CREATE INDEX notification_history_person_idx ON notification_delivery_history(household_id,user_id,sequence DESC);
CREATE INDEX notification_history_retention_idx ON notification_delivery_history(recorded_at);

-- Issue #116スパイク: D1(SQLite)でのhousehold単位アクセス制御検証用スキーマ。
-- 既存のSupabase RLSスパイク(supabase/migrations/20260812055256_init_household_rls_spike.sql)
-- と対になる最小構成。D1にはRLSがないため、認可はすべてアプリ層(lib/d1-spike/*)で行う。

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE household_members (
  household_id TEXT NOT NULL REFERENCES households(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (household_id, user_id)
);

CREATE INDEX household_members_user_id_idx ON household_members(user_id);

CREATE TABLE managed_items (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX managed_items_household_id_idx ON managed_items(household_id);

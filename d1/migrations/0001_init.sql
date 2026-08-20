-- YAMORUの正式D1スキーマ。IDはアプリ層でcrypto.randomUUID()により採番する。
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT,
  session_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (email = lower(trim(email)) AND length(email) BETWEEN 3 AND 320)
);

CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (name = trim(name) AND length(name) BETWEEN 1 AND 100)
);

CREATE TABLE household_members (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (household_id, user_id),
  UNIQUE (user_id)
);
CREATE INDEX household_members_user_id_idx ON household_members(user_id);

CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (nickname = trim(nickname) AND length(nickname) BETWEEN 1 AND 20)
);

CREATE TABLE managed_items (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, household_id),
  CHECK (name = trim(name) AND length(name) BETWEEN 1 AND 100),
  CHECK (kind IN ('pet_supplies', 'appliance', 'housing_equipment', 'contract', 'other'))
);
CREATE INDEX managed_items_household_id_idx ON managed_items(household_id);

CREATE TABLE external_links (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  managed_item_id TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (managed_item_id, household_id) REFERENCES managed_items(id, household_id) ON DELETE CASCADE,
  CHECK (url = trim(url) AND length(url) BETWEEN 1 AND 2048 AND (url GLOB 'http://*' OR url GLOB 'https://*'))
);
CREATE INDEX external_links_household_id_idx ON external_links(household_id);
CREATE INDEX external_links_managed_item_id_idx ON external_links(managed_item_id);

CREATE TABLE task_rules (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  managed_item_id TEXT REFERENCES managed_items(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  recurrence_basis TEXT NOT NULL,
  deadline_kind TEXT NOT NULL,
  unresolved_policy TEXT NOT NULL DEFAULT 'carry_over',
  recommended_start_offset INTEGER NOT NULL DEFAULT 0,
  recommended_until_offset INTEGER NOT NULL DEFAULT 0,
  schedule_kind TEXT,
  schedule_day_of_week INTEGER,
  schedule_day_of_month INTEGER,
  schedule_week_of_month INTEGER,
  schedule_month INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, household_id),
  FOREIGN KEY (managed_item_id, household_id) REFERENCES managed_items(id, household_id) ON DELETE CASCADE,
  CHECK (title = trim(title) AND length(title) BETWEEN 1 AND 100),
  CHECK (recurrence_basis IN ('completion', 'once', 'calendar')),
  CHECK (deadline_kind IN ('maintenance', 'strict')),
  CHECK (unresolved_policy = 'carry_over'),
  CHECK (recommended_start_offset BETWEEN 0 AND 3650 AND recommended_until_offset BETWEEN recommended_start_offset AND 3650),
  CHECK ((recurrence_basis = 'completion' AND deadline_kind = 'maintenance' AND schedule_kind IS NULL)
    OR (recurrence_basis = 'once' AND deadline_kind = 'strict' AND recommended_start_offset = 0 AND recommended_until_offset = 0 AND schedule_kind IS NULL)
    OR (recurrence_basis = 'calendar' AND deadline_kind = 'strict' AND recommended_start_offset = 0 AND recommended_until_offset = 0
      AND ((schedule_kind = 'weekly' AND schedule_day_of_week BETWEEN 1 AND 7 AND schedule_day_of_month IS NULL AND schedule_week_of_month IS NULL AND schedule_month IS NULL)
        OR (schedule_kind = 'monthly_day' AND schedule_day_of_week IS NULL AND schedule_day_of_month BETWEEN 1 AND 31 AND schedule_week_of_month IS NULL AND schedule_month IS NULL)
        OR (schedule_kind = 'monthly_nth_weekday' AND schedule_day_of_week BETWEEN 1 AND 7 AND schedule_day_of_month IS NULL AND schedule_week_of_month BETWEEN 1 AND 5 AND schedule_month IS NULL)
        OR (schedule_kind = 'yearly' AND schedule_day_of_week IS NULL AND schedule_day_of_month BETWEEN 1 AND 31 AND schedule_week_of_month IS NULL AND schedule_month BETWEEN 1 AND 12))))
);
CREATE INDEX task_rules_household_id_idx ON task_rules(household_id);

CREATE TABLE task_occurrences (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  task_rule_id TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  due_at TEXT NOT NULL,
  assignee_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, household_id),
  UNIQUE (task_rule_id, scheduled_for),
  FOREIGN KEY (task_rule_id, household_id) REFERENCES task_rules(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, assignee_user_id) REFERENCES household_members(household_id, user_id),
  CHECK (scheduled_for <= due_at),
  CHECK (status IN ('pending', 'completed', 'skipped'))
);
CREATE INDEX task_occurrences_household_id_idx ON task_occurrences(household_id);
CREATE UNIQUE INDEX task_occurrences_one_pending_per_rule_idx ON task_occurrences(task_rule_id) WHERE status = 'pending';

CREATE TABLE activity_logs (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  task_occurrence_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  performed_by_user_id TEXT,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  idempotency_key TEXT,
  next_task_occurrence_id TEXT,
  assignee_user_id TEXT,
  FOREIGN KEY (task_occurrence_id, household_id) REFERENCES task_occurrences(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, actor_user_id) REFERENCES household_members(household_id, user_id),
  FOREIGN KEY (household_id, performed_by_user_id) REFERENCES household_members(household_id, user_id),
  FOREIGN KEY (household_id, assignee_user_id) REFERENCES household_members(household_id, user_id),
  UNIQUE (household_id, idempotency_key),
  CHECK (action IN ('completed', 'completion_undone', 'postponed', 'skipped', 'assignee_changed')),
  CHECK ((action = 'completed') = (performed_by_user_id IS NOT NULL))
);
CREATE INDEX activity_logs_household_id_idx ON activity_logs(household_id);
CREATE INDEX activity_logs_occurrence_id_idx ON activity_logs(task_occurrence_id);
CREATE INDEX activity_logs_completed_occurrence_recorded_idx ON activity_logs(task_occurrence_id, recorded_at DESC, id DESC) WHERE action = 'completed';

CREATE TABLE household_invitations (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL COLLATE NOCASE,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  cancelled_at TEXT,
  accepted_at TEXT,
  accepted_by_user_id TEXT,
  replaced_at TEXT,
  FOREIGN KEY (household_id, created_by_user_id) REFERENCES household_members(household_id, user_id),
  FOREIGN KEY (household_id, accepted_by_user_id) REFERENCES household_members(household_id, user_id),
  CHECK (status IN ('pending', 'cancelled', 'accepted', 'replaced')),
  CHECK (invited_email = lower(trim(invited_email)) AND length(invited_email) BETWEEN 3 AND 320),
  CHECK (expires_at > created_at)
);
CREATE INDEX household_invitations_household_id_idx ON household_invitations(household_id);
CREATE UNIQUE INDEX household_invitations_one_pending_email_idx ON household_invitations(household_id, invited_email) WHERE status = 'pending';

-- Generated file. Do not edit directly.
-- Source of truth: d1/migrations/
-- Regenerate: npm run d1:schema:generate

-- table: activity_logs
CREATE TABLE "activity_logs" (
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
  previous_due_at TEXT,
  new_due_at TEXT,
  previous_assignee_user_id TEXT,
  new_assignee_user_id TEXT,
  FOREIGN KEY (task_occurrence_id, household_id) REFERENCES "task_occurrences"(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, actor_user_id) REFERENCES household_members(household_id, user_id),
  FOREIGN KEY (household_id, performed_by_user_id) REFERENCES household_members(household_id, user_id),
  FOREIGN KEY (household_id, assignee_user_id) REFERENCES household_members(household_id, user_id),
  UNIQUE (household_id, idempotency_key),
  CHECK (action IN ('completed', 'completion_undone', 'postponed', 'skipped', 'assignee_changed')),
  CHECK ((action = 'completed') = (performed_by_user_id IS NOT NULL))
);

-- table: completion_corrections
CREATE TABLE "completion_corrections" (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  task_occurrence_id TEXT NOT NULL,
  completed_activity_log_id TEXT NOT NULL REFERENCES "activity_logs"(id),
  actor_user_id TEXT NOT NULL,
  corrected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  idempotency_key TEXT,
  previous_occurred_at TEXT NOT NULL,
  new_occurred_at TEXT,
  previous_performed_by_user_id TEXT,
  new_performed_by_user_id TEXT,
  FOREIGN KEY (task_occurrence_id, household_id) REFERENCES "task_occurrences"(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, actor_user_id) REFERENCES household_members(household_id, user_id),
  FOREIGN KEY (household_id, new_performed_by_user_id) REFERENCES household_members(household_id, user_id),
  UNIQUE (household_id, idempotency_key),
  CHECK (((new_occurred_at IS NOT NULL) + (new_performed_by_user_id IS NOT NULL)) = 1)
);

-- table: consumable_refills
CREATE TABLE consumable_refills (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  consumable_id TEXT NOT NULL,
  refilled_on TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, household_id),
  FOREIGN KEY (consumable_id, household_id)
    REFERENCES consumables(id, household_id) ON DELETE CASCADE,
  CHECK (
    refilled_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(refilled_on, '+0 days') = refilled_on
  )
);

-- table: consumables
CREATE TABLE consumables (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  note TEXT,
  product_code TEXT,
  external_url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), stock_status TEXT NOT NULL DEFAULT 'available'
  CHECK (stock_status IN ('available', 'low', 'out')),
  UNIQUE (id, household_id),
  CHECK (name = trim(name) AND length(name) BETWEEN 1 AND 100),
  CHECK (note IS NULL OR (note = trim(note) AND length(note) BETWEEN 1 AND 1000)),
  CHECK (product_code IS NULL OR (product_code = trim(product_code) AND length(product_code) BETWEEN 1 AND 200)),
  CHECK (external_url IS NULL OR (
    external_url = trim(external_url)
    AND length(external_url) BETWEEN 1 AND 2048
    AND (external_url GLOB 'http://*' OR external_url GLOB 'https://*')
  ))
);

-- table: external_links
CREATE TABLE external_links (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  managed_item_id TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (managed_item_id, household_id) REFERENCES managed_items(id, household_id) ON DELETE CASCADE,
  CHECK (url = trim(url) AND length(url) BETWEEN 1 AND 2048 AND (url GLOB 'http://*' OR url GLOB 'https://*'))
);

-- table: household_invitations
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
  replaced_at TEXT, replaced_by_invitation_id TEXT,
  FOREIGN KEY (household_id, created_by_user_id) REFERENCES household_members(household_id, user_id),
  FOREIGN KEY (household_id, accepted_by_user_id) REFERENCES household_members(household_id, user_id),
  CHECK (status IN ('pending', 'cancelled', 'accepted', 'replaced')),
  CHECK (invited_email = lower(trim(invited_email)) AND length(invited_email) BETWEEN 3 AND 320),
  CHECK (expires_at > created_at)
);

-- table: household_members
CREATE TABLE household_members (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), source_id TEXT,
  PRIMARY KEY (household_id, user_id),
  UNIQUE (user_id)
);

-- table: households
CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (name = trim(name) AND length(name) BETWEEN 1 AND 100)
);

-- table: invitation_claims
CREATE TABLE invitation_claims (
  id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL REFERENCES household_invitations(id) ON DELETE CASCADE,
  claim_secret_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK (expires_at > created_at)
);

-- table: managed_item_classifications
CREATE TABLE managed_item_classifications (
  managed_item_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  kind_code TEXT NOT NULL REFERENCES managed_item_kinds(code),
  item_type_code TEXT,
  custom_item_type TEXT,
  FOREIGN KEY (managed_item_id, household_id) REFERENCES managed_items(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (item_type_code, kind_code) REFERENCES managed_item_type_presets(code, kind_code),
  CHECK (item_type_code IS NULL OR custom_item_type IS NULL),
  CHECK (custom_item_type IS NULL OR (custom_item_type = trim(custom_item_type) AND length(custom_item_type) BETWEEN 1 AND 50))
);

-- table: managed_item_consumables
CREATE TABLE managed_item_consumables (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  managed_item_id TEXT NOT NULL,
  consumable_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (managed_item_id, consumable_id),
  FOREIGN KEY (managed_item_id, household_id)
    REFERENCES managed_items(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (consumable_id, household_id)
    REFERENCES consumables(id, household_id) ON DELETE CASCADE
);

-- table: managed_item_kinds
CREATE TABLE managed_item_kinds (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  legacy_kind TEXT NOT NULL,
  CHECK (code = trim(code) AND length(code) BETWEEN 1 AND 50),
  CHECK (label = trim(label) AND length(label) BETWEEN 1 AND 50),
  CHECK (is_active IN (0, 1)),
  CHECK (legacy_kind IN ('pet_supplies', 'appliance', 'housing_equipment', 'contract', 'other'))
);

-- table: managed_item_type_presets
CREATE TABLE managed_item_type_presets (
  code TEXT PRIMARY KEY,
  kind_code TEXT NOT NULL REFERENCES managed_item_kinds(code),
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  legacy_kind TEXT NOT NULL,
  UNIQUE (code, kind_code),
  UNIQUE (kind_code, sort_order),
  CHECK (code = trim(code) AND length(code) BETWEEN 1 AND 50),
  CHECK (label = trim(label) AND length(label) BETWEEN 1 AND 50),
  CHECK (is_active IN (0, 1)),
  CHECK (legacy_kind IN ('pet_supplies', 'appliance', 'housing_equipment', 'contract', 'other'))
);

-- table: managed_item_type_suggestions
CREATE TABLE managed_item_type_suggestions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,


  kind_code TEXT NOT NULL,


  item_name TEXT NOT NULL,


  suggested_labels TEXT NOT NULL,
  adopted_label TEXT,
  adoption_kind TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  adopted_at TEXT,





  UNIQUE (id, household_id),
  CHECK (adoption_kind IS NULL OR adoption_kind IN ('ai_suggestion', 'corrected')),


  CHECK ((adoption_kind IS NULL) = (adopted_label IS NULL)),
  CHECK ((adoption_kind IS NULL) = (adopted_at IS NULL))
);

-- table: managed_items
CREATE TABLE managed_items (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), note TEXT
  CHECK (note IS NULL OR (note = trim(note) AND length(note) BETWEEN 1 AND 1000)), product_info TEXT
  CHECK (product_info IS NULL OR (product_info = trim(product_info) AND length(product_info) BETWEEN 1 AND 200)), purchased_on TEXT
  CHECK (purchased_on IS NULL
    OR purchased_on GLOB '[0-9][0-9][0-9][0-9]'
    OR purchased_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
    OR purchased_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'), started_on TEXT
  CHECK (started_on IS NULL
    OR started_on GLOB '[0-9][0-9][0-9][0-9]'
    OR started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
    OR started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  UNIQUE (id, household_id),
  CHECK (name = trim(name) AND length(name) BETWEEN 1 AND 100),
  CHECK (kind IN ('pet_supplies', 'appliance', 'housing_equipment', 'contract', 'other'))
);

-- table: profiles
CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (nickname = trim(nickname) AND length(nickname) BETWEEN 1 AND 20)
);

-- table: task_occurrences
CREATE TABLE "task_occurrences" (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  task_rule_id TEXT NOT NULL,
  scheduled_for TEXT,
  due_at TEXT,
  assignee_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  completion_calendar_version INTEGER
    CHECK (completion_calendar_version IS NULL OR completion_calendar_version = 1),
  schedule_spec_version INTEGER
    CHECK (schedule_spec_version IS NULL OR schedule_spec_version = 1),
  rule_snapshot TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(rule_snapshot)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, household_id),
  UNIQUE (task_rule_id, scheduled_for),
  FOREIGN KEY (task_rule_id, household_id) REFERENCES "task_rules"(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, assignee_user_id) REFERENCES household_members(household_id, user_id),
  CHECK (
    (scheduled_for IS NULL AND due_at IS NULL)
    OR (scheduled_for IS NOT NULL AND due_at IS NOT NULL AND scheduled_for <= due_at)
  ),
  CHECK (status IN ('pending', 'completed', 'skipped'))
);

-- table: task_rule_changes
CREATE TABLE "task_rule_changes" (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  task_rule_id TEXT NOT NULL,
  task_occurrence_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  previous_rule_snapshot TEXT NOT NULL CHECK (json_valid(previous_rule_snapshot)),
  new_rule_snapshot TEXT NOT NULL CHECK (json_valid(new_rule_snapshot)),
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (task_rule_id, household_id)
    REFERENCES "task_rules"(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (task_occurrence_id, household_id)
    REFERENCES "task_occurrences"(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, actor_user_id)
    REFERENCES household_members(household_id, user_id)
);

-- table: task_rule_consumables
CREATE TABLE "task_rule_consumables" (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  task_rule_id TEXT NOT NULL,
  consumable_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (task_rule_id, consumable_id),
  FOREIGN KEY (task_rule_id, household_id)
    REFERENCES "task_rules"(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (consumable_id, household_id)
    REFERENCES consumables(id, household_id) ON DELETE CASCADE
);

-- table: task_rule_schedules
CREATE TABLE "task_rule_schedules" (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  task_rule_id TEXT NOT NULL,
  schedule_kind TEXT NOT NULL,
  day_of_week INTEGER NOT NULL DEFAULT 0,
  week_of_month INTEGER NOT NULL DEFAULT 0,
  week_last INTEGER NOT NULL DEFAULT 0,
  day_of_month INTEGER NOT NULL DEFAULT 0,
  month_end INTEGER NOT NULL DEFAULT 0,
  month INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, household_id),
  UNIQUE (task_rule_id, day_of_week, week_of_month, week_last, day_of_month, month_end, month),
  FOREIGN KEY (task_rule_id, household_id) REFERENCES "task_rules"(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (task_rule_id, schedule_kind) REFERENCES "task_rules"(id, schedule_kind) ON DELETE CASCADE,
  CHECK (week_last IN (0, 1)),
  CHECK (week_last = 0 OR (
    schedule_kind IN ('monthly_nth_weekday', 'yearly_nth_weekday') AND week_of_month = 5
  )),
  CHECK (month_end IN (0, 1)),
  CHECK (month_end = 0 OR (schedule_kind = 'monthly_day' AND day_of_month = 31)),
  CHECK (
    (schedule_kind = 'weekly' AND day_of_week BETWEEN 1 AND 7
      AND week_of_month = 0 AND week_last = 0
      AND day_of_month = 0 AND month = 0)
    OR (schedule_kind = 'monthly_day' AND day_of_week = 0
      AND week_of_month = 0 AND week_last = 0
      AND day_of_month BETWEEN 1 AND 31 AND month = 0)
    OR (schedule_kind = 'monthly_nth_weekday' AND day_of_week BETWEEN 1 AND 7
      AND week_of_month BETWEEN 1 AND 5 AND day_of_month = 0 AND month = 0)
    OR (schedule_kind = 'yearly' AND day_of_week = 0
      AND week_of_month = 0 AND week_last = 0
      AND day_of_month BETWEEN 1 AND 31 AND month BETWEEN 1 AND 12)
    OR (schedule_kind = 'yearly_nth_weekday' AND day_of_week BETWEEN 1 AND 7
      AND week_of_month BETWEEN 1 AND 5 AND day_of_month = 0
      AND month BETWEEN 1 AND 12)
  )
);

-- table: task_rules
CREATE TABLE "task_rules" (
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
  schedule_month_end INTEGER NOT NULL DEFAULT 0,
  interval_unit TEXT,
  interval_count INTEGER,
  interval_anchor_on TEXT,
  recommended_start_value INTEGER,
  recommended_until_value INTEGER,
  recommended_unit TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, household_id),
  UNIQUE (id, schedule_kind),
  FOREIGN KEY (managed_item_id, household_id) REFERENCES managed_items(id, household_id) ON DELETE CASCADE,
  CHECK (title = trim(title) AND length(title) BETWEEN 1 AND 100),
  CHECK (recurrence_basis IN ('completion', 'once', 'calendar', 'interval', 'manual')),
  CHECK (deadline_kind IN ('maintenance', 'strict')),
  CHECK (unresolved_policy = 'carry_over'),
  CHECK (schedule_month_end IN (0, 1)),
  CHECK (recommended_start_offset BETWEEN 0 AND 3650 AND recommended_until_offset BETWEEN recommended_start_offset AND 3650),
  CHECK ((recurrence_basis = 'interval') = (interval_unit IS NOT NULL)
    AND (recurrence_basis = 'interval') = (interval_count IS NOT NULL)
    AND (recurrence_basis = 'interval') = (interval_anchor_on IS NOT NULL)),
  CHECK ((recurrence_basis = 'completion' AND deadline_kind = 'maintenance' AND schedule_kind IS NULL)
    OR (recurrence_basis = 'once' AND deadline_kind = 'strict' AND recommended_start_offset = 0 AND recommended_until_offset = 0 AND schedule_kind IS NULL)
    OR (recurrence_basis = 'manual' AND deadline_kind = 'strict' AND recommended_start_offset = 0 AND recommended_until_offset = 0
      AND schedule_kind IS NULL AND schedule_day_of_week IS NULL AND schedule_day_of_month IS NULL
      AND schedule_week_of_month IS NULL AND schedule_month IS NULL AND schedule_month_end = 0)
    OR (recurrence_basis = 'calendar' AND deadline_kind = 'strict' AND recommended_start_offset = 0 AND recommended_until_offset = 0
      AND ((schedule_kind = 'weekly' AND schedule_day_of_week BETWEEN 1 AND 7 AND schedule_day_of_month IS NULL AND schedule_week_of_month IS NULL AND schedule_month IS NULL)
        OR (schedule_kind = 'monthly_day' AND schedule_day_of_week IS NULL AND schedule_day_of_month BETWEEN 1 AND 31 AND schedule_week_of_month IS NULL AND schedule_month IS NULL)
        OR (schedule_kind = 'monthly_nth_weekday' AND schedule_day_of_week BETWEEN 1 AND 7 AND schedule_day_of_month IS NULL AND schedule_week_of_month BETWEEN 1 AND 5 AND schedule_month IS NULL)
        OR (schedule_kind = 'yearly' AND schedule_day_of_week IS NULL AND schedule_day_of_month BETWEEN 1 AND 31 AND schedule_week_of_month IS NULL AND schedule_month BETWEEN 1 AND 12)
        OR (schedule_kind = 'yearly_nth_weekday' AND schedule_day_of_week BETWEEN 1 AND 7 AND schedule_day_of_month IS NULL AND schedule_week_of_month BETWEEN 1 AND 5 AND schedule_month BETWEEN 1 AND 12)))
    OR (recurrence_basis = 'interval' AND deadline_kind = 'strict' AND recommended_start_offset = 0 AND recommended_until_offset = 0
      AND schedule_kind IS NULL AND schedule_day_of_week IS NULL AND schedule_day_of_month IS NULL
      AND schedule_week_of_month IS NULL AND schedule_month IS NULL AND schedule_month_end = 0
      AND interval_unit IN ('day', 'week')
      AND interval_count = CAST(interval_count AS INTEGER)
      AND interval_count BETWEEN 1 AND (CASE interval_unit WHEN 'week' THEN 520 ELSE 3650 END)
      AND interval_anchor_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(interval_anchor_on) = interval_anchor_on))
);

-- table: user_consumable_favorites
CREATE TABLE user_consumable_favorites (
  user_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  consumable_id TEXT NOT NULL,
  favorited_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, consumable_id),
  FOREIGN KEY (household_id, user_id)
    REFERENCES household_members(household_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (consumable_id, household_id)
    REFERENCES consumables(id, household_id) ON DELETE CASCADE
);

-- table: user_consumable_pins
CREATE TABLE user_consumable_pins (
  user_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  consumable_id TEXT NOT NULL,
  pinned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, consumable_id),
  FOREIGN KEY (household_id, user_id)
    REFERENCES household_members(household_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (consumable_id, household_id)
    REFERENCES consumables(id, household_id) ON DELETE CASCADE
);

-- table: users
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT,
  session_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (email = lower(trim(email)) AND length(email) BETWEEN 3 AND 320)
);

-- index: activity_logs_completed_occurrence_recorded_idx
CREATE INDEX activity_logs_completed_occurrence_recorded_idx
  ON activity_logs(task_occurrence_id, recorded_at DESC, id DESC)
  WHERE action = 'completed';

-- index: activity_logs_household_id_idx
CREATE INDEX activity_logs_household_id_idx ON activity_logs(household_id);

-- index: activity_logs_occurrence_id_idx
CREATE INDEX activity_logs_occurrence_id_idx ON activity_logs(task_occurrence_id);

-- index: completion_corrections_completed_log_idx
CREATE INDEX completion_corrections_completed_log_idx
  ON completion_corrections(completed_activity_log_id, corrected_at DESC, id DESC);

-- index: completion_corrections_household_id_idx
CREATE INDEX completion_corrections_household_id_idx ON completion_corrections(household_id);

-- index: completion_corrections_occurrence_idx
CREATE INDEX completion_corrections_occurrence_idx
  ON completion_corrections(task_occurrence_id, corrected_at DESC, id DESC);

-- index: consumable_refills_household_consumable_date_idx
CREATE INDEX consumable_refills_household_consumable_date_idx
  ON consumable_refills(
    household_id,
    consumable_id,
    refilled_on DESC,
    recorded_at DESC,
    id DESC
  );

-- index: consumables_household_id_idx
CREATE INDEX consumables_household_id_idx ON consumables(household_id);

-- index: consumables_household_stock_status_idx
CREATE INDEX consumables_household_stock_status_idx
  ON consumables(household_id, stock_status);

-- index: external_links_household_id_idx
CREATE INDEX external_links_household_id_idx ON external_links(household_id);

-- index: external_links_managed_item_id_idx
CREATE INDEX external_links_managed_item_id_idx ON external_links(managed_item_id);

-- index: household_invitations_household_id_idx
CREATE INDEX household_invitations_household_id_idx ON household_invitations(household_id);

-- index: household_invitations_one_pending_email_idx
CREATE UNIQUE INDEX household_invitations_one_pending_email_idx ON household_invitations(household_id, invited_email) WHERE status = 'pending';

-- index: household_invitations_replaced_by_idx
CREATE INDEX household_invitations_replaced_by_idx
  ON household_invitations(replaced_by_invitation_id)
  WHERE replaced_by_invitation_id IS NOT NULL;

-- index: household_members_source_id_idx
CREATE UNIQUE INDEX household_members_source_id_idx
  ON household_members(source_id) WHERE source_id IS NOT NULL;

-- index: household_members_user_id_idx
CREATE INDEX household_members_user_id_idx ON household_members(user_id);

-- index: invitation_claims_expires_at_idx
CREATE INDEX invitation_claims_expires_at_idx ON invitation_claims(expires_at);

-- index: invitation_claims_invitation_id_idx
CREATE INDEX invitation_claims_invitation_id_idx ON invitation_claims(invitation_id);

-- index: managed_item_classifications_household_id_idx
CREATE INDEX managed_item_classifications_household_id_idx ON managed_item_classifications(household_id);

-- index: managed_item_classifications_kind_code_idx
CREATE INDEX managed_item_classifications_kind_code_idx ON managed_item_classifications(kind_code);

-- index: managed_item_consumables_consumable_id_idx
CREATE INDEX managed_item_consumables_consumable_id_idx
  ON managed_item_consumables(consumable_id);

-- index: managed_item_consumables_household_id_idx
CREATE INDEX managed_item_consumables_household_id_idx
  ON managed_item_consumables(household_id);

-- index: managed_item_type_suggestions_adopted_idx
CREATE INDEX managed_item_type_suggestions_adopted_idx
  ON managed_item_type_suggestions (household_id, kind_code, adopted_at);

-- index: managed_items_household_id_idx
CREATE INDEX managed_items_household_id_idx ON managed_items(household_id);

-- index: task_occurrences_household_id_idx
CREATE INDEX task_occurrences_household_id_idx ON task_occurrences(household_id);

-- index: task_occurrences_one_pending_per_rule_idx
CREATE UNIQUE INDEX task_occurrences_one_pending_per_rule_idx
  ON task_occurrences(task_rule_id) WHERE status = 'pending';

-- index: task_rule_changes_household_id_idx
CREATE INDEX task_rule_changes_household_id_idx
  ON task_rule_changes(household_id);

-- index: task_rule_changes_occurrence_idx
CREATE INDEX task_rule_changes_occurrence_idx
  ON task_rule_changes(task_occurrence_id, changed_at, id);

-- index: task_rule_consumables_consumable_id_idx
CREATE INDEX task_rule_consumables_consumable_id_idx
  ON task_rule_consumables(consumable_id);

-- index: task_rule_consumables_household_id_idx
CREATE INDEX task_rule_consumables_household_id_idx
  ON task_rule_consumables(household_id);

-- index: task_rule_schedules_task_rule_id_idx
CREATE INDEX task_rule_schedules_task_rule_id_idx
  ON task_rule_schedules (task_rule_id, household_id);

-- index: task_rules_household_id_idx
CREATE INDEX task_rules_household_id_idx ON task_rules(household_id);

-- index: user_consumable_favorites_household_user_idx
CREATE INDEX user_consumable_favorites_household_user_idx
  ON user_consumable_favorites(household_id, user_id, favorited_at DESC);

-- index: user_consumable_pins_household_user_idx
CREATE INDEX user_consumable_pins_household_user_idx
  ON user_consumable_pins(household_id, user_id, pinned_at DESC);

-- trigger: sync_legacy_from_pins_delete
CREATE TRIGGER sync_legacy_from_pins_delete
AFTER DELETE ON user_consumable_pins
BEGIN
  DELETE FROM user_consumable_favorites
  WHERE user_id = OLD.user_id AND consumable_id = OLD.consumable_id;
END;

-- trigger: sync_legacy_from_pins_insert
CREATE TRIGGER sync_legacy_from_pins_insert
AFTER INSERT ON user_consumable_pins
BEGIN
  INSERT OR IGNORE INTO user_consumable_favorites (
    user_id, household_id, consumable_id, favorited_at
  ) VALUES (
    NEW.user_id, NEW.household_id, NEW.consumable_id, NEW.pinned_at
  );
END;

-- trigger: sync_pins_from_legacy_delete
CREATE TRIGGER sync_pins_from_legacy_delete
AFTER DELETE ON user_consumable_favorites
BEGIN
  DELETE FROM user_consumable_pins
  WHERE user_id = OLD.user_id AND consumable_id = OLD.consumable_id;
END;

-- trigger: sync_pins_from_legacy_insert
CREATE TRIGGER sync_pins_from_legacy_insert
AFTER INSERT ON user_consumable_favorites
BEGIN
  INSERT OR IGNORE INTO user_consumable_pins (
    user_id, household_id, consumable_id, pinned_at
  ) VALUES (
    NEW.user_id, NEW.household_id, NEW.consumable_id, NEW.favorited_at
  );
END;

-- trigger: task_occurrences_completion_calendar_insert
CREATE TRIGGER task_occurrences_completion_calendar_insert
BEFORE INSERT ON task_occurrences
FOR EACH ROW
WHEN NEW.completion_calendar_version IS NOT 1
  AND EXISTS (
    SELECT 1
      FROM task_rules r
     WHERE r.id = NEW.task_rule_id
       AND r.household_id = NEW.household_id
       AND r.recurrence_basis = 'completion'
       AND r.recommended_unit IN ('month', 'year')
  )
BEGIN
  SELECT RAISE(ABORT, 'calendar-aware Worker is required for month/year completion recurrence');
END;

-- trigger: task_occurrences_manual_requires_undated_insert
CREATE TRIGGER task_occurrences_manual_requires_undated_insert
BEFORE INSERT ON task_occurrences
WHEN NEW.scheduled_for IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'manual recurrence requires an undated occurrence')
   WHERE EXISTS (
     SELECT 1 FROM task_rules r
      WHERE r.id = NEW.task_rule_id
        AND r.household_id = NEW.household_id
        AND r.recurrence_basis = 'manual'
   );
END;

-- trigger: task_occurrences_manual_requires_undated_update
CREATE TRIGGER task_occurrences_manual_requires_undated_update
BEFORE UPDATE OF scheduled_for, due_at, task_rule_id, household_id ON task_occurrences
WHEN NEW.scheduled_for IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'manual recurrence requires an undated occurrence')
   WHERE EXISTS (
     SELECT 1 FROM task_rules r
      WHERE r.id = NEW.task_rule_id
        AND r.household_id = NEW.household_id
        AND r.recurrence_basis = 'manual'
   );
END;

-- trigger: task_occurrences_schedule_spec_insert
CREATE TRIGGER task_occurrences_schedule_spec_insert
BEFORE INSERT ON task_occurrences
FOR EACH ROW
WHEN NEW.schedule_spec_version IS NOT 1
  AND (
    (SELECT count(*) FROM task_rule_schedules s
      WHERE s.task_rule_id = NEW.task_rule_id
        AND s.household_id = NEW.household_id) > 1
    OR EXISTS (
      SELECT 1 FROM task_rule_schedules s
       WHERE s.task_rule_id = NEW.task_rule_id
         AND s.household_id = NEW.household_id
         AND (s.week_last = 1 OR s.schedule_kind = 'yearly_nth_weekday')
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'multi-spec calendar rules require a schedule-spec-aware Worker');
END;

-- trigger: task_occurrences_undated_once_or_manual_insert
CREATE TRIGGER task_occurrences_undated_once_or_manual_insert
BEFORE INSERT ON task_occurrences
WHEN NEW.scheduled_for IS NULL
BEGIN
  SELECT RAISE(ABORT, 'undated occurrence requires once or manual recurrence')
   WHERE NOT EXISTS (
     SELECT 1 FROM task_rules r
      WHERE r.id = NEW.task_rule_id
        AND r.household_id = NEW.household_id
        AND r.recurrence_basis IN ('once', 'manual')
   );
END;

-- trigger: task_occurrences_undated_once_or_manual_update
CREATE TRIGGER task_occurrences_undated_once_or_manual_update
BEFORE UPDATE OF scheduled_for, due_at, task_rule_id, household_id ON task_occurrences
WHEN NEW.scheduled_for IS NULL
BEGIN
  SELECT RAISE(ABORT, 'undated occurrence requires once or manual recurrence')
   WHERE NOT EXISTS (
     SELECT 1 FROM task_rules r
      WHERE r.id = NEW.task_rule_id
        AND r.household_id = NEW.household_id
        AND r.recurrence_basis IN ('once', 'manual')
   );
END;

-- trigger: task_rule_consumables_maintenance_only
CREATE TRIGGER task_rule_consumables_maintenance_only
BEFORE INSERT ON task_rule_consumables
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM task_rules
   WHERE id = NEW.task_rule_id
     AND household_id = NEW.household_id
     AND deadline_kind = 'maintenance'
)
BEGIN
  SELECT RAISE(ABORT, 'Task rule must be maintenance and belong to the household');
END;

-- trigger: task_rules_completion_interval_insert
CREATE TRIGGER task_rules_completion_interval_insert
BEFORE INSERT ON task_rules
WHEN NOT (
  (NEW.recurrence_basis = 'completion' AND (
    (NEW.recommended_start_value IS NULL
      AND NEW.recommended_until_value IS NULL
      AND NEW.recommended_unit IS NULL)
    OR
    (NEW.recommended_start_value IS NOT NULL
      AND NEW.recommended_until_value IS NOT NULL
      AND NEW.recommended_unit IN ('day', 'week', 'month', 'year')
      AND NEW.recommended_start_value = CAST(NEW.recommended_start_value AS INTEGER)
      AND NEW.recommended_until_value = CAST(NEW.recommended_until_value AS INTEGER)
      AND NEW.recommended_start_value BETWEEN 0 AND NEW.recommended_until_value
      AND NEW.recommended_until_value <= CASE NEW.recommended_unit
        WHEN 'day' THEN 3650
        WHEN 'week' THEN 520
        WHEN 'month' THEN 120
        WHEN 'year' THEN 10
      END)
  ))
  OR
  (NEW.recurrence_basis <> 'completion'
    AND NEW.recommended_start_value IS NULL
    AND NEW.recommended_until_value IS NULL
    AND NEW.recommended_unit IS NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'invalid completion calendar interval');
END;

-- trigger: task_rules_completion_interval_update
CREATE TRIGGER task_rules_completion_interval_update
BEFORE UPDATE OF recurrence_basis, recommended_start_value, recommended_until_value, recommended_unit
ON task_rules
WHEN NOT (
  (NEW.recurrence_basis = 'completion' AND (
    (NEW.recommended_start_value IS NULL
      AND NEW.recommended_until_value IS NULL
      AND NEW.recommended_unit IS NULL)
    OR
    (NEW.recommended_start_value IS NOT NULL
      AND NEW.recommended_until_value IS NOT NULL
      AND NEW.recommended_unit IN ('day', 'week', 'month', 'year')
      AND NEW.recommended_start_value = CAST(NEW.recommended_start_value AS INTEGER)
      AND NEW.recommended_until_value = CAST(NEW.recommended_until_value AS INTEGER)
      AND NEW.recommended_start_value BETWEEN 0 AND NEW.recommended_until_value
      AND NEW.recommended_until_value <= CASE NEW.recommended_unit
        WHEN 'day' THEN 3650
        WHEN 'week' THEN 520
        WHEN 'month' THEN 120
        WHEN 'year' THEN 10
      END)
  ))
  OR
  (NEW.recurrence_basis <> 'completion'
    AND NEW.recommended_start_value IS NULL
    AND NEW.recommended_until_value IS NULL
    AND NEW.recommended_unit IS NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'invalid completion calendar interval');
END;

-- trigger: task_rules_keep_undated_occurrences_once_or_manual
CREATE TRIGGER task_rules_keep_undated_occurrences_once_or_manual
BEFORE UPDATE OF recurrence_basis ON task_rules
WHEN NEW.recurrence_basis NOT IN ('once', 'manual')
BEGIN
  SELECT RAISE(ABORT, 'undated occurrence requires once or manual recurrence')
   WHERE EXISTS (
     SELECT 1 FROM task_occurrences o
      WHERE o.task_rule_id = OLD.id
        AND o.household_id = OLD.household_id
        AND o.scheduled_for IS NULL
   );
END;

-- trigger: task_rules_manual_requires_undated_occurrences
CREATE TRIGGER task_rules_manual_requires_undated_occurrences
BEFORE UPDATE OF recurrence_basis ON task_rules
WHEN NEW.recurrence_basis = 'manual'
BEGIN
  SELECT RAISE(ABORT, 'manual recurrence requires an undated occurrence')
   WHERE EXISTS (
     SELECT 1 FROM task_occurrences o
      WHERE o.task_rule_id = OLD.id
        AND o.household_id = OLD.household_id
        AND o.scheduled_for IS NOT NULL
   );
END;

-- trigger: task_rules_month_end_requires_monthly_day_insert
CREATE TRIGGER task_rules_month_end_requires_monthly_day_insert
BEFORE INSERT ON task_rules
WHEN NEW.schedule_month_end = 1
  AND (NEW.schedule_kind IS NOT 'monthly_day' OR NEW.schedule_day_of_month IS NOT 31)
BEGIN
  SELECT RAISE(ABORT, 'schedule_month_end requires monthly_day at day 31');
END;

-- trigger: task_rules_month_end_requires_monthly_day_update
CREATE TRIGGER task_rules_month_end_requires_monthly_day_update
BEFORE UPDATE OF schedule_month_end, schedule_kind, schedule_day_of_month ON task_rules
WHEN NEW.schedule_month_end = 1
  AND (NEW.schedule_kind IS NOT 'monthly_day' OR NEW.schedule_day_of_month IS NOT 31)
BEGIN
  SELECT RAISE(ABORT, 'schedule_month_end requires monthly_day at day 31');
END;

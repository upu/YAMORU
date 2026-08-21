-- Issue #124: Supabaseの主キーと追記型履歴をD1移行後も検証できるようにする。
ALTER TABLE household_members ADD COLUMN source_id TEXT;
CREATE UNIQUE INDEX household_members_source_id_idx
  ON household_members(source_id) WHERE source_id IS NOT NULL;

ALTER TABLE activity_logs ADD COLUMN previous_due_at TEXT;
ALTER TABLE activity_logs ADD COLUMN new_due_at TEXT;
ALTER TABLE activity_logs ADD COLUMN previous_assignee_user_id TEXT;
ALTER TABLE activity_logs ADD COLUMN new_assignee_user_id TEXT;

ALTER TABLE household_invitations ADD COLUMN replaced_by_invitation_id TEXT;
CREATE INDEX household_invitations_replaced_by_idx
  ON household_invitations(replaced_by_invitation_id)
  WHERE replaced_by_invitation_id IS NOT NULL;

-- 生の招待tokenをURLから除去した後に使う、短命なclaimのhashだけを保持する。
CREATE TABLE invitation_claims (
  id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL REFERENCES household_invitations(id) ON DELETE CASCADE,
  claim_secret_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX invitation_claims_invitation_id_idx ON invitation_claims(invitation_id);
CREATE INDEX invitation_claims_expires_at_idx ON invitation_claims(expires_at);

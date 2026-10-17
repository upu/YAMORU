-- #439 / YDR-058: operational counters and fenced commit leases; no household facts are changed.
CREATE TABLE integration_mcp_rate_windows (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL CHECK(bucket IN ('read','prepare','commit')),
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK(request_count > 0),
  PRIMARY KEY(user_id,bucket,window_start)
);
CREATE INDEX integration_mcp_rate_window_cleanup ON integration_mcp_rate_windows(window_start);

CREATE TABLE integration_mcp_commit_leases (
  connection_id TEXT NOT NULL REFERENCES oauth_connections(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK(slot IN (0,1)),
  lease_id TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(connection_id,slot)
);

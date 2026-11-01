-- docs/specs/connected-apps.md. `code_hash` names the authorization code a token
-- came from, so replaying that code ends the token. `last_used_at` is the Apps
-- page's "last used", updated at most hourly.
ALTER TABLE oauth_tokens ADD COLUMN code_hash TEXT;
ALTER TABLE oauth_tokens ADD COLUMN last_used_at INTEGER;
CREATE INDEX oauth_tokens_code_hash ON oauth_tokens (code_hash);

-- What approved apps did: one row per attempted write. It has no foreign keys and
-- keeps the app's name, because it must outlive the app and its tokens.
CREATE TABLE connected_app_events (
  id TEXT PRIMARY KEY NOT NULL,
  address TEXT NOT NULL,
  client_id TEXT NOT NULL,
  app_name TEXT NOT NULL,
  token_id TEXT NOT NULL,
  issuer_id TEXT NOT NULL,
  action TEXT NOT NULL,
  subject TEXT,
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX connected_app_events_address ON connected_app_events (address, created_at);

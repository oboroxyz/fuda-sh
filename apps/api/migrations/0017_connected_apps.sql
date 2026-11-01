-- Connected apps (docs/specs/connected-apps.md): a browser-only app an
-- operator registers, approves for one of their issuers, and that then calls
-- the api with an access token bound to that issuer. Codes and tokens are
-- stored as SHA-256 hashes only, as sessions are.
CREATE TABLE connected_apps (
  client_id TEXT PRIMARY KEY NOT NULL,
  owner_address TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX connected_apps_owner ON connected_apps (owner_address);

-- One row per registered redirect URI. `origin` is kept beside it so the CORS
-- check can ask "is this origin any app's?" with an index rather than parsing.
CREATE TABLE connected_app_redirects (
  client_id TEXT NOT NULL REFERENCES connected_apps(client_id),
  redirect_uri TEXT NOT NULL,
  origin TEXT NOT NULL,
  PRIMARY KEY (client_id, redirect_uri)
);
CREATE INDEX connected_app_redirects_origin ON connected_app_redirects (origin);

CREATE TABLE oauth_codes (
  code_hash TEXT PRIMARY KEY NOT NULL,
  client_id TEXT NOT NULL REFERENCES connected_apps(client_id),
  issuer_id TEXT NOT NULL REFERENCES issuers(id),
  address TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX oauth_codes_expires_at ON oauth_codes (expires_at);

CREATE TABLE oauth_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL REFERENCES connected_apps(client_id),
  issuer_id TEXT NOT NULL REFERENCES issuers(id),
  address TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX oauth_tokens_address ON oauth_tokens (address);
CREATE INDEX oauth_tokens_client ON oauth_tokens (client_id);

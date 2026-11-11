CREATE INDEX passkey_challenges_created_at ON passkey_challenges (created_at);
CREATE INDEX sessions_expires_at ON sessions (expires_at);
CREATE INDEX rate_limits_window_start ON rate_limits (window_start);
CREATE INDEX oauth_tokens_expires_at ON oauth_tokens (expires_at);
CREATE INDEX oauth_tokens_revoked_at ON oauth_tokens (revoked_at);

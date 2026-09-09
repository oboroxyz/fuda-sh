CREATE TABLE stamp_settings (
  issuer_id TEXT PRIMARY KEY NOT NULL REFERENCES issuers(id),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  daily_limit INTEGER NOT NULL DEFAULT 1 CHECK (daily_limit BETWEEN 1 AND 100),
  goal INTEGER NOT NULL DEFAULT 10 CHECK (goal BETWEEN 1 AND 1000)
);

ALTER TABLE entry_log ADD COLUMN reception_id TEXT;
CREATE UNIQUE INDEX entry_log_reception_id ON entry_log(reception_id);

CREATE TABLE stamp_credits (
  issuer_id TEXT NOT NULL REFERENCES issuers(id),
  uid TEXT NOT NULL,
  day TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 100),
  at INTEGER NOT NULL,
  operator_address TEXT NOT NULL,
  entry_log_id INTEGER NOT NULL UNIQUE REFERENCES entry_log(id),
  PRIMARY KEY (issuer_id, uid, day, ordinal)
);

CREATE TABLE reception_requests (
  id TEXT PRIMARY KEY NOT NULL,
  issuer_id TEXT NOT NULL REFERENCES issuers(id),
  uid TEXT NOT NULL,
  response TEXT NOT NULL,
  entry_log_id INTEGER NOT NULL REFERENCES entry_log(id)
);

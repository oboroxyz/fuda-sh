CREATE TABLE badges (
  uid         TEXT NOT NULL,
  kind        TEXT NOT NULL,
  verifier    TEXT NOT NULL,
  scope       TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  credential  TEXT NOT NULL,
  verified_at INTEGER NOT NULL,
  expires_at  INTEGER,
  PRIMARY KEY (uid, kind)
);
CREATE UNIQUE INDEX badges_subject ON badges (verifier, scope, subject_key);

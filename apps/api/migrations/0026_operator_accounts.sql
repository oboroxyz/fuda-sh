-- void:allow-destructive
-- An issuer belongs to an account, or, for one made through a wallet sign-in, to an
-- address (docs/specs/pass-types-and-flows.md#issuer-onboarding-and-the-handle-route).
-- SQLite cannot change NOT NULL or add a CHECK, so `issuers` is rebuilt; every row,
-- id and column is copied as it is.
--
-- Rebuilt through a copy and back under the same name, as in 0018: D1 counts the rows
-- orphaned by the drop as deferred foreign-key violations, and only inserting the
-- parent rows back into a table named `issuers` clears that count.
PRAGMA defer_foreign_keys = true;

CREATE TABLE issuers_copy AS SELECT * FROM issuers;

DROP TABLE issuers;

CREATE TABLE issuers (
  id                TEXT PRIMARY KEY,
  handle            TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  tagline           TEXT NOT NULL DEFAULT '',
  brand_color       TEXT NOT NULL,
  operator_address  TEXT,
  owner_account_id  TEXT REFERENCES accounts(id),
  created_at        INTEGER NOT NULL,
  logo_prefix       TEXT,
  default_card_slug TEXT,
  CHECK ((operator_address IS NULL) <> (owner_account_id IS NULL))
);

INSERT INTO issuers
  (id, handle, name, tagline, brand_color, operator_address, created_at, logo_prefix, default_card_slug)
SELECT id, handle, name, tagline, brand_color, operator_address, created_at, logo_prefix, default_card_slug
FROM issuers_copy;

DROP TABLE issuers_copy;

CREATE INDEX issuers_operator_address ON issuers (operator_address, created_at);
CREATE INDEX issuers_owner_account ON issuers (owner_account_id, created_at);

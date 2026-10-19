-- One account may own several issuers (docs/adr/0009-several-issuers-per-account.md).
-- SQLite cannot drop a column-level UNIQUE, so `issuers` is rebuilt without it;
-- every row, id and column is copied as it is, and the handle stays unique.
--
-- The rebuild goes through a copy and back under the same name rather than
-- the usual "create new, drop old, rename". Dropping `issuers` orphans every
-- row that references it (cards, stamp settings, credits, receptions, codes,
-- tokens) and D1 counts each one as a deferred foreign-key violation; only
-- inserting the parent rows back into a table named `issuers` clears that
-- count, so a rename alone leaves the migration to fail at commit.
PRAGMA defer_foreign_keys = true;

CREATE TABLE issuers_copy AS SELECT * FROM issuers;

DROP TABLE issuers;

CREATE TABLE issuers (
  id                TEXT PRIMARY KEY,
  handle            TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  tagline           TEXT NOT NULL DEFAULT '',
  brand_color       TEXT NOT NULL,
  operator_address  TEXT NOT NULL,            -- the owning account's address; lowercase; no longer unique
  created_at        INTEGER NOT NULL,
  logo_prefix       TEXT,
  default_card_slug TEXT
);

INSERT INTO issuers
  (id, handle, name, tagline, brand_color, operator_address, created_at, logo_prefix, default_card_slug)
SELECT id, handle, name, tagline, brand_color, operator_address, created_at, logo_prefix, default_card_slug
FROM issuers_copy;

DROP TABLE issuers_copy;

CREATE INDEX issuers_operator_address ON issuers (operator_address, created_at);

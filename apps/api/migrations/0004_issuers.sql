-- Issuer onboarding (docs/specs/pass-types-and-flows.md#surfaces): an issuer is
-- the product/branding entity behind a /@handle route; every attestation still
-- comes from the fuda signer under DELEGATION_UID.
CREATE TABLE issuers (
  id               TEXT PRIMARY KEY,           -- random uuid
  handle           TEXT NOT NULL UNIQUE,       -- the /@<handle> slug (docs/specs/ens-naming.md issuer label)
  name             TEXT NOT NULL,              -- venue display name
  tagline          TEXT NOT NULL DEFAULT '',
  brand_color      TEXT NOT NULL,              -- #RRGGBB, upper-cased
  operator_address TEXT NOT NULL UNIQUE,       -- the passkey (Base Account) address that signed in; lowercase
  created_at       INTEGER NOT NULL            -- unix seconds
);

CREATE TABLE cards (
  id            TEXT PRIMARY KEY,               -- random uuid
  issuer_id     TEXT NOT NULL REFERENCES issuers(id),
  title         TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('membership', 'ticket')),
  perk          TEXT NOT NULL DEFAULT '',
  reward        TEXT NOT NULL DEFAULT '',
  validity_days INTEGER,                        -- NULL = never expires; else validUntil = issued + days
  lock_screen   INTEGER NOT NULL DEFAULT 0,     -- 1 = show the pass near the venue
  venue_lat     REAL,
  venue_lng     REAL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX cards_issuer_id ON cards(issuer_id);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,                  -- sha256 hex of the bearer token; the token itself is never stored
  address    TEXT NOT NULL,                     -- lowercase operator address
  issuer_id  TEXT,                              -- filled at sign-in when the address already owns an issuer
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- A self-serve right knows the card it was issued under; admin-issued rows keep NULL.
ALTER TABLE members ADD COLUMN card_id TEXT;
CREATE UNIQUE INDEX members_card_member ON members(card_id, member_id) WHERE card_id IS NOT NULL;

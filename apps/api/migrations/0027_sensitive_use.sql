-- void:allow-destructive
-- docs/specs/pass-types-and-flows.md#sensitive-use. SQLite cannot change a CHECK in place,
-- so the column moves over to one that also allows 'sensitive'.
ALTER TABLE cards ADD COLUMN identity_next TEXT NOT NULL DEFAULT 'none'
  CHECK (identity_next = 'none' OR (identity_next IN ('passkey', 'sensitive') AND record = 'offchain'));
UPDATE cards SET identity_next = identity;
ALTER TABLE cards DROP COLUMN identity;
ALTER TABLE cards RENAME COLUMN identity_next TO identity;

-- One ciphertext of the member secret per passkey that can hold one. The server never sees
-- the secret or a PRF output. A copy goes with its passkey.
CREATE TABLE member_secret_copies (
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  credential_id TEXT NOT NULL REFERENCES passkeys(credential_id) ON DELETE CASCADE,
  iv            TEXT NOT NULL,
  ciphertext    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (account_id, credential_id)
);

-- The list of an account's Sensitive passes, as one ciphertext only the member can open.
-- A write names the version it read, so a second device cannot silently drop a pass.
CREATE TABLE member_vaults (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  iv         TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  version    INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- How enrollment went, as a count and nothing else: no account, no device, no time.
CREATE TABLE member_secret_outcomes (
  outcome TEXT PRIMARY KEY CHECK (outcome IN ('prf', 'no_prf')),
  total   INTEGER NOT NULL
);

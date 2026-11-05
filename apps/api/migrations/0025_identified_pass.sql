-- void:allow-destructive
-- docs/specs/attestation-model.md#offchain-rights. A card's passes are either usable by
-- whoever shows them, or bound to the passkey that claimed them. Like `record`, this is
-- fixed when the card is created, and only an offchain pass can carry a passkey.
ALTER TABLE cards ADD COLUMN identity TEXT NOT NULL DEFAULT 'none'
  CHECK (identity = 'none' OR (identity = 'passkey' AND record = 'offchain'));

-- SQLite cannot change a CHECK in place. These rows live 300 seconds, so one in flight at
-- deploy is simply asked for again.
DROP TABLE passkey_challenges;
CREATE TABLE passkey_challenges (
  challenge  TEXT PRIMARY KEY,
  purpose    TEXT NOT NULL CHECK (purpose IN ('register', 'login', 'add', 'claim')),
  account_id TEXT,
  user_handle TEXT,
  created_at INTEGER NOT NULL
);

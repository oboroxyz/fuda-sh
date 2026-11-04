-- docs/specs/pass-types-and-flows.md#member-sign-in. A member account is identified
-- by its passkeys, with no address and no email. `user_handle` is the WebAuthn user
-- id every passkey of the account shares, so a provider never holds two for one
-- account by accident.
CREATE TABLE accounts (
  id          TEXT PRIMARY KEY,
  user_handle TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);

CREATE TABLE passkeys (
  credential_id TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  public_key    TEXT NOT NULL,
  counter       INTEGER NOT NULL,
  transports    TEXT NOT NULL,
  backed_up     INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER
);
CREATE INDEX passkeys_account ON passkeys(account_id);

-- One-time ceremony challenges. `account_id` is set only for adding a passkey to a
-- signed-in account, so a challenge cannot move between accounts or purposes.
CREATE TABLE passkey_challenges (
  challenge  TEXT PRIMARY KEY,
  purpose    TEXT NOT NULL CHECK (purpose IN ('register', 'login', 'add')),
  account_id TEXT,
  user_handle TEXT,
  created_at INTEGER NOT NULL
);

-- The passes an account keeps. Many to many on purpose: whoever has a Standard pass's
-- uid can already use it, so linking grants nothing, and a uid someone else linked
-- first must not lock its holder out.
CREATE TABLE member_passes (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  uid        TEXT NOT NULL,
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (account_id, uid)
);

-- A member session names an account. An operator session still names an address, and
-- `address` stays empty on a member session, because the column is NOT NULL.
ALTER TABLE sessions ADD COLUMN account_id TEXT;

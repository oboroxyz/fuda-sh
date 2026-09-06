CREATE TABLE members (
  attestation_uid TEXT PRIMARY KEY,          -- 0x…64; one row per issued right
  member_id       TEXT NOT NULL DEFAULT '',  -- persistent id: operator-chosen (bearer), holder address (signed), optional representative id (private); NOT unique
  holder          TEXT,                      -- attested address (bearer/signed); NULL for private rows — the stealth address is never stored
  level           TEXT NOT NULL,             -- 'bearer' | 'signed' | 'private' (mirror of the on-chain `level`)
  tier            INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'revoked'
  created_at      INTEGER NOT NULL           -- unix seconds
);
CREATE INDEX members_holder ON members(holder);
CREATE INDEX members_member_id ON members(member_id);

CREATE TABLE rate_limits (
  ip           TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL,
  PRIMARY KEY (ip, window_start)
);

CREATE TABLE challenges (
  nonce      TEXT PRIMARY KEY,
  uid        TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used_at    INTEGER
);

CREATE TABLE slots (                          -- SINGLE_USE consumption
  uid         TEXT NOT NULL,
  slot        TEXT NOT NULL,                  -- 'default' in the MVP
  consumed_at INTEGER NOT NULL,
  PRIMARY KEY (uid, slot)
);

CREATE TABLE entry_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  uid      TEXT NOT NULL,
  decision TEXT NOT NULL,                     -- 'ADMIT' | 'REJECT'
  reason   TEXT NOT NULL,                     -- reason table above
  path     TEXT NOT NULL,                     -- 'qr' | 'signature' (entry path, not the right's level)
  at       INTEGER NOT NULL,
  attendance_uid TEXT                          -- written back after the Attendance attest lands
);

CREATE TABLE announcements (
  tx_hash           TEXT NOT NULL,
  log_index         INTEGER NOT NULL,
  block_number      INTEGER NOT NULL,
  scheme_id         INTEGER NOT NULL,
  stealth_address   TEXT NOT NULL,
  caller            TEXT NOT NULL,
  ephemeral_pub_key TEXT NOT NULL,
  metadata          TEXT NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);

CREATE TABLE sync_state (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

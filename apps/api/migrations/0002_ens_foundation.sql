CREATE TABLE ens_names (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  issuer_handle         TEXT NOT NULL,
  name                  TEXT NOT NULL UNIQUE,
  kind                  TEXT NOT NULL CHECK (kind IN ('issuer', 'member')),
  owner_address         TEXT NOT NULL,
  target_address        TEXT,
  expiry                INTEGER,
  voucher_issued_at     INTEGER,
  claim_tx_hash         TEXT,
  unregister_tx_hash    TEXT,
  right_uid             TEXT,
  level                 TEXT CHECK (level IS NULL OR level IN ('bearer', 'signed', 'private')),
  stealth_meta_address  TEXT,
  status                TEXT NOT NULL CHECK (
    status IN ('offchain', 'voucher_issued', 'claimed', 'failed', 'unregistered')
  ),
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  CHECK (
    (
      kind = 'issuer'
      AND right_uid IS NULL
      AND level IS NULL
      AND stealth_meta_address IS NULL
      AND target_address IS NOT NULL
    )
    OR
    (
      kind = 'member'
      AND right_uid IS NOT NULL
      AND level IS NOT NULL
      AND (
        (level = 'private' AND target_address IS NULL AND stealth_meta_address IS NOT NULL)
        OR
        (level != 'private' AND target_address IS NOT NULL AND stealth_meta_address IS NULL)
      )
    )
  )
);
CREATE INDEX ens_names_issuer_handle ON ens_names(issuer_handle);
CREATE INDEX ens_names_right_uid ON ens_names(right_uid);
CREATE INDEX ens_names_status ON ens_names(status);

CREATE TABLE stealth_resolutions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  ens_name_id           INTEGER NOT NULL REFERENCES ens_names(id) ON DELETE CASCADE,
  nonce_counter         INTEGER NOT NULL,
  stealth_address       TEXT NOT NULL UNIQUE,
  ephemeral_public_key  TEXT NOT NULL,
  view_tag              TEXT NOT NULL,
  resolved_at           INTEGER NOT NULL,
  used_at               INTEGER,
  expires_at            INTEGER,
  UNIQUE (ens_name_id, nonce_counter)
);
CREATE INDEX stealth_resolutions_ens_name_id ON stealth_resolutions(ens_name_id);

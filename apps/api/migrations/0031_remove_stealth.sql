-- void:allow-destructive
-- +Private is gone (docs/adr/0014-offchain-default-pass-types.md, decision 6), so
-- the one-time stealth resolution ledger and the meta-address column go with it.
--
-- SQLite refuses to drop `stealth_meta_address` while the table-level
-- `ens_names_shape` CHECK still names it, so `ens_names` is rebuilt instead.
-- `resolution_counter` only numbered one-time stealth addresses and goes too.
-- A +Private name has no target address and cannot satisfy the new shape, so
-- those rows are deleted first. `stealth_resolutions` is the only table that
-- references `ens_names`, and it is dropped before the rebuild.
DROP TABLE stealth_resolutions;

DELETE FROM ens_names WHERE level = 'private';

CREATE TABLE ens_names_rebuilt (
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
  level                 TEXT CHECK (level IS NULL OR level IN ('bearer', 'signed')),
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
      AND target_address IS NOT NULL
    )
    OR
    (
      kind = 'member'
      AND right_uid IS NOT NULL
      AND level IS NOT NULL
      AND target_address IS NOT NULL
    )
  )
);

INSERT INTO ens_names_rebuilt
  (id, issuer_handle, name, kind, owner_address, target_address, expiry, voucher_issued_at,
   claim_tx_hash, unregister_tx_hash, right_uid, level, status, created_at, updated_at)
SELECT
  id, issuer_handle, name, kind, owner_address, target_address, expiry, voucher_issued_at,
  claim_tx_hash, unregister_tx_hash, right_uid, level, status, created_at, updated_at
FROM ens_names;

DROP TABLE ens_names;

ALTER TABLE ens_names_rebuilt RENAME TO ens_names;

CREATE INDEX ens_names_issuer_handle ON ens_names(issuer_handle);
CREATE INDEX ens_names_right_uid ON ens_names(right_uid);
CREATE INDEX ens_names_status ON ens_names(status);

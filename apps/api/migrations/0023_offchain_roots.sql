-- docs/specs/attestation-model.md#offchain-rights. A root groups offchain passes and
-- is timestamped on EAS. It is written and tied to its passes before the transaction,
-- so a failed send retries the same root; `anchored_at` stays NULL until it lands.
-- Passes are found by `offchain_attestations.root`, and a tree is rebuilt from their
-- uids, so the tree itself is never stored.
CREATE TABLE offchain_roots (
  root        TEXT PRIMARY KEY,
  pass_count  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  tx_hash     TEXT,
  anchored_at INTEGER
);

ALTER TABLE offchain_attestations ADD COLUMN root TEXT;
CREATE INDEX offchain_attestations_root ON offchain_attestations(root);

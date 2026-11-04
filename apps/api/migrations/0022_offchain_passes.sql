-- docs/specs/attestation-model.md#offchain-rights. Cards made before this keep
-- issuing on chain; the card routes default new cards to 'offchain'.
ALTER TABLE cards ADD COLUMN record TEXT NOT NULL DEFAULT 'onchain';

-- The signed attestation behind an offchain right. `members` keeps the row every
-- other surface reads, and its `status` is the revocation record the gate checks
-- first. `revoke_tx` stays NULL until the on-chain revocation has landed, which
-- is what a retry looks for.
CREATE TABLE offchain_attestations (
  uid        TEXT PRIMARY KEY,
  signed     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoke_tx  TEXT
);

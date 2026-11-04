-- docs/specs/pass-types-and-flows.md#venue-reception-and-stamps. An append-only
-- ledger beside stamp_credits: a card's total is the credit count plus the sum of
-- delta here. A redemption is -goal; a manual adjustment is a signed correction
-- with a reason. Rows are never updated or deleted, so history stays.
CREATE TABLE stamp_adjustments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  issuer_id        TEXT NOT NULL REFERENCES issuers(id),
  uid              TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('redeem', 'adjust')),
  delta            INTEGER NOT NULL CHECK (delta != 0),
  note             TEXT NOT NULL,
  operator_address TEXT NOT NULL,
  request_id       TEXT NOT NULL UNIQUE,
  at               INTEGER NOT NULL
);
CREATE INDEX stamp_adjustments_pass ON stamp_adjustments(issuer_id, uid, id);

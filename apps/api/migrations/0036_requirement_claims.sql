CREATE TABLE card_applicants (
  card_id TEXT NOT NULL REFERENCES cards(id),
  address TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (card_id, address)
);
CREATE INDEX card_applicants_applied ON card_applicants(card_id, applied_at, address);

CREATE TABLE card_address_passes (
  card_id TEXT NOT NULL REFERENCES cards(id),
  address TEXT NOT NULL,
  attestation_uid TEXT NOT NULL REFERENCES members(attestation_uid),
  PRIMARY KEY (card_id, address)
);

CREATE TABLE pass_evidence (
  attestation_uid TEXT NOT NULL REFERENCES members(attestation_uid),
  position INTEGER NOT NULL,
  kind TEXT NOT NULL,
  evidence TEXT NOT NULL,
  PRIMARY KEY (attestation_uid, position)
);

ALTER TABLE cards ADD COLUMN has_requirements INTEGER NOT NULL DEFAULT 0;
UPDATE cards SET has_requirements = 1 WHERE EXISTS (SELECT 1 FROM card_requirements WHERE card_id = cards.id);
CREATE INDEX card_address_passes_uid ON card_address_passes(attestation_uid);

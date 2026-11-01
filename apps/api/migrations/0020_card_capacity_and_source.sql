-- docs/specs/pass-types-and-flows.md#capacity-and-source. `reserved` counts every
-- pass issued under a card; `capacity` caps it, and NULL leaves it uncapped.
ALTER TABLE cards ADD COLUMN capacity INTEGER;
ALTER TABLE cards ADD COLUMN reserved INTEGER NOT NULL DEFAULT 0;
UPDATE cards SET reserved = (SELECT COUNT(*) FROM members WHERE members.card_id = cards.id)
WHERE id IN (SELECT card_id FROM members);

-- The label a pass was claimed through. Self-reported by the claim link, so it
-- only ever feeds counts.
ALTER TABLE members ADD COLUMN source TEXT;

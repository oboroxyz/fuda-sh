-- Immutable snapshots of the entitlement fields used to decide a Pass's local
-- lifecycle. Historical rows remain NULL because current Card settings cannot
-- reconstruct what was issued in the past.
ALTER TABLE members ADD COLUMN valid_from INTEGER;
ALTER TABLE members ADD COLUMN valid_until INTEGER;
ALTER TABLE members ADD COLUMN usage_model INTEGER;

CREATE INDEX members_issuer_created ON members(issuer_id, created_at);
CREATE INDEX members_issuer_card_status ON members(issuer_id, card_id, status);

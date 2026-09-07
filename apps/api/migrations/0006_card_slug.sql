-- A card is reachable at `fuda.sh/@<handle>/<slug>`, so its slug is unique
-- within the venue (docs/specs/pass-types-and-flows.md#issuer-onboarding-and-the-handle-route).
-- The slug is a product path, never an ENS label.
ALTER TABLE cards ADD COLUMN slug TEXT NOT NULL DEFAULT '';

-- Cards that predate slugs take the venue's handle, which is unique by
-- construction, so the backfill cannot collide.
UPDATE cards
SET slug = (SELECT issuers.handle FROM issuers WHERE issuers.id = cards.issuer_id)
WHERE slug = '';

CREATE UNIQUE INDEX cards_issuer_slug ON cards(issuer_id, slug);

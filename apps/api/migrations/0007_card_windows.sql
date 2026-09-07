-- A card carries two independent time windows
-- (docs/specs/pass-types-and-flows.md#issuer-onboarding-and-the-handle-route).
--
-- The claim window says when the card is handed out at all: a stamp card is
-- open forever, a concert's card closes when its doors do. Without it a
-- finished event keeps minting rights nobody can use, at the signer's expense.
--
-- The validity window says how long an issued right lasts, in one of two
-- shapes. `validity_days` is relative — N days from the moment this member
-- claimed it, which suits a trial or a coupon. `valid_from`/`valid_until` are
-- absolute unix seconds, the same for everyone however early they claimed,
-- which is the only shape that expresses "this evening's concert".
ALTER TABLE cards ADD COLUMN claim_from INTEGER;
ALTER TABLE cards ADD COLUMN claim_until INTEGER;
ALTER TABLE cards ADD COLUMN valid_from INTEGER;
ALTER TABLE cards ADD COLUMN valid_until INTEGER;

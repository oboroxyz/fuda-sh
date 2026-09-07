-- A member number is unique per issuer, not per card
-- (docs/specs/ens-naming.md#member-number): the ENS label is
-- `<member-no>.<issuer>.fuda.eth`, so two cards of one venue minting the same
-- number would collide on one name. SQLite cannot express that across the
-- cards join, so the issuer is denormalized onto the row it constrains.
ALTER TABLE members ADD COLUMN issuer_id TEXT;

UPDATE members
SET issuer_id = (SELECT cards.issuer_id FROM cards WHERE cards.id = members.card_id)
WHERE card_id IS NOT NULL;

DROP INDEX members_card_member;
CREATE UNIQUE INDEX members_issuer_member ON members(issuer_id, member_id) WHERE issuer_id IS NOT NULL;
CREATE INDEX members_card_id ON members(card_id);

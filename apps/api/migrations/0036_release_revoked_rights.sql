-- Rights revoked before revocation released places and badges still hold both.
-- Run before deploying the api that releases them on revoke, so no Right is released twice.
UPDATE cards SET reserved = max(0, reserved - (
  SELECT count(*) FROM members WHERE members.card_id = cards.id AND members.status = 'revoked'
))
WHERE EXISTS (SELECT 1 FROM members WHERE members.card_id = cards.id AND members.status = 'revoked');

DELETE FROM badges WHERE uid IN (SELECT attestation_uid FROM members WHERE status = 'revoked');

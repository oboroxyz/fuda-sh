-- docs/specs/attestation-model.md#entitlement-lifecycle. Whether a scan of an
-- on-chain card writes a public Attendance. A ticket starts with it on, a
-- membership with it off, and an off-chain card never has it.
ALTER TABLE cards ADD COLUMN attendance INTEGER NOT NULL DEFAULT 0;
UPDATE cards SET attendance = 1 WHERE record = 'onchain' AND category = 'ticket';

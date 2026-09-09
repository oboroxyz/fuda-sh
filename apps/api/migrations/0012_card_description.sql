-- Retain existing onboarding text in its original order before removing
-- the two fields that misleadingly suggested configured benefits.
ALTER TABLE cards ADD COLUMN description TEXT NOT NULL DEFAULT '';

UPDATE cards SET description = CASE
  WHEN perk <> '' AND reward <> '' THEN perk || char(10) || reward
  ELSE perk || reward
END;

ALTER TABLE cards DROP COLUMN perk;
ALTER TABLE cards DROP COLUMN reward;

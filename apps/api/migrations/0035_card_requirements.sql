-- void:allow-destructive
-- docs/specs/card-requirements.md. SQLite cannot change a CHECK in place, so the column moves
-- over to one that also allows 'address', as 0026 did for 'sensitive'.
ALTER TABLE cards ADD COLUMN identity_next TEXT NOT NULL DEFAULT 'none'
  CHECK (identity_next = 'none' OR (identity_next IN ('passkey', 'sensitive', 'address') AND record = 'offchain'));
UPDATE cards SET identity_next = identity;
ALTER TABLE cards DROP COLUMN identity;
ALTER TABLE cards RENAME COLUMN identity_next TO identity;

-- What a member must hold to claim a pass under a Card, fixed when the Card is created.
-- `config` is the JSON of the parsed requirement. `kind` has no CHECK, so a new kind needs no
-- table rebuild; the api parses every row through its kind's schema.
CREATE TABLE card_requirements (
  card_id  TEXT NOT NULL REFERENCES cards(id),
  position INTEGER NOT NULL,
  kind     TEXT NOT NULL,
  config   TEXT NOT NULL,
  PRIMARY KEY (card_id, position)
);

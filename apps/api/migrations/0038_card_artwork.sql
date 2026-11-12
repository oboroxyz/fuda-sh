ALTER TABLE cards ADD COLUMN artwork_prefix TEXT;
CREATE INDEX cards_artwork_prefix ON cards(artwork_prefix);

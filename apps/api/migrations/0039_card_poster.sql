ALTER TABLE cards ADD COLUMN poster_prefix TEXT;
CREATE INDEX cards_poster_prefix ON cards(poster_prefix);

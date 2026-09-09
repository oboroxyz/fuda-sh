CREATE TABLE card_stamp_settings (
  card_id TEXT PRIMARY KEY NOT NULL REFERENCES cards(id),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  daily_limit INTEGER NOT NULL DEFAULT 1 CHECK (daily_limit BETWEEN 1 AND 100),
  goal INTEGER NOT NULL DEFAULT 10 CHECK (goal BETWEEN 1 AND 1000)
);

-- Preserve existing behavior for existing cards, without making future cards
-- inherit an issuer-wide policy. Credits and reception receipts stay intact.
INSERT INTO card_stamp_settings (card_id, enabled, daily_limit, goal)
SELECT c.id, s.enabled, s.daily_limit, s.goal
FROM cards c JOIN stamp_settings s ON s.issuer_id = c.issuer_id;

-- A Card's integrations, one row per Card that has ever saved them. No row
-- means every integration is off, so existing Cards keep behaving as if the
-- optional services did not exist until their operator opts in.
CREATE TABLE card_integrations (
  card_id TEXT PRIMARY KEY NOT NULL REFERENCES cards(id),
  human_badge INTEGER NOT NULL DEFAULT 0 CHECK (human_badge IN (0, 1))
);

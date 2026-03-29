-- Add Metacritic score to games (for tags like "Metacritic above 80").
-- Apply after 001_init.sql on existing databases.

BEGIN;

ALTER TABLE games ADD COLUMN IF NOT EXISTS metacritic INTEGER;

COMMENT ON COLUMN games.metacritic IS 'Metacritic score 0–100; NULL if unknown.';

INSERT INTO tags (name, category) VALUES
  ('Metacritic above 80', 'critics')
ON CONFLICT (name) DO NOTHING;

COMMIT;

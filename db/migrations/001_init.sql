-- GameGrid: games, tags, and junction for 3x3 intersection puzzles.
-- Apply: psql "postgresql://USER:PASS@localhost:5432/gamegrid" -f db/migrations/001_init.sql
-- Or:    docker exec -i <postgres_container> psql -U postgres -d gamegrid -f - < db/migrations/001_init.sql

BEGIN;

CREATE TABLE IF NOT EXISTS games (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  year INTEGER,
  studio TEXT,
  publisher TEXT,
  img_url TEXT,
  external_id INTEGER UNIQUE,
  metacritic INTEGER,
  genres JSONB NOT NULL DEFAULT '[]'::jsonb,
  rawg_tags JSONB NOT NULL DEFAULT '[]'::jsonb
);

COMMENT ON TABLE games IS 'Games sourced from RAWG (external_id) or manual entry.';
COMMENT ON COLUMN games.external_id IS 'RAWG API game id';
COMMENT ON COLUMN games.metacritic IS 'Metacritic score 0–100; NULL if unknown.';

CREATE TABLE IF NOT EXISTS tags (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  CONSTRAINT tags_name_unique UNIQUE (name)
);

COMMENT ON TABLE tags IS 'Filter dimensions: genre, feature, year bucket, etc.';
COMMENT ON COLUMN tags.category IS 'e.g. genre, feature, year';

CREATE TABLE IF NOT EXISTS game_tags (
  game_id INTEGER NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (game_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_game_tags_tag_id ON game_tags (tag_id);

-- Seed tags for development (expand when you add tag_pairs / puzzles)
INSERT INTO tags (name, category) VALUES
  ('RPG', 'genre'),
  ('Action', 'genre'),
  ('FPS', 'genre'),
  ('Strategy', 'genre'),
  ('Indie', 'genre'),
  ('Open world', 'feature'),
  ('Multiplayer', 'feature'),
  ('Co-op', 'feature'),
  ('Roguelike', 'feature'),
  ('Metroidvania', 'feature'),
  ('Published after 2010', 'year'),
  ('Published after 2015', 'year'),
  ('Published before 2005', 'year'),
  ('Metacritic above 80', 'critics')
ON CONFLICT (name) DO NOTHING;

COMMIT;

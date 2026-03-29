-- Store RAWG genres + game tags for deriving `game_tags` rows.

BEGIN;

ALTER TABLE games ADD COLUMN IF NOT EXISTS genres JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE games ADD COLUMN IF NOT EXISTS rawg_tags JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN games.genres IS 'RAWG /games/{id} genres: [{ id, name, slug }, ...]';
COMMENT ON COLUMN games.rawg_tags IS 'RAWG /games/{id} tags (e.g. Singleplayer, Open World): [{ name, slug }, ...]';

COMMIT;

/** Derive `game_tags` rows from `games` + seeded `tags` (genres, years, critics, RAWG tag names). */

import type { Pool } from "pg";

type RawgGenre = { name: string; slug?: string };
type RawgTag = { name: string; slug?: string };

type GameRow = {
  id: number;
  year: number | null;
  metacritic: number | null;
  genres: RawgGenre[] | unknown;
  rawg_tags: RawgTag[] | unknown;
};

/** Map RAWG genre slug/name to our `tags.name` for category genre. */
function mapRawgGenreToTagName(g: RawgGenre): string | null {
  const slug = (g.slug ?? "").toLowerCase();
  const name = g.name.toLowerCase();

  const slugMap: Record<string, string> = {
    action: "Action",
    "role-playing-games-rpg": "RPG",
    rpg: "RPG",
    shooter: "FPS",
    strategy: "Strategy",
    indie: "Indie",
  };
  if (slug && slugMap[slug]) return slugMap[slug];

  if (name === "action") return "Action";
  if (name === "rpg" || name.includes("role-playing")) return "RPG";
  if (name === "shooter" || name.includes("first-person shooter")) return "FPS";
  if (name === "strategy") return "Strategy";
  if (name === "indie") return "Indie";

  const direct = ["RPG", "Action", "FPS", "Strategy", "Indie"];
  for (const d of direct) {
    if (name === d.toLowerCase()) return d;
  }
  return null;
}

/** Map RAWG game tag label to our feature `tags.name`. */
function mapRawgGameTagToFeatureName(rawName: string): string | null {
  const n = rawName.toLowerCase().trim();

  const checks: { tag: string; needles: string[] }[] = [
    { tag: "Open world", needles: ["open world", "open-world", "openworld"] },
    { tag: "Multiplayer", needles: ["multiplayer", "massively multiplayer"] },
    { tag: "Co-op", needles: ["co-op", "coop", "cooperative", "online co-op"] },
    { tag: "Roguelike", needles: ["roguelike", "rogue-like"] },
    { tag: "Metroidvania", needles: ["metroidvania", "metrovania"] },
  ];

  for (const { tag, needles } of checks) {
    if (needles.some((k) => n.includes(k))) return tag;
  }
  return null;
}

function asArray<T>(v: unknown): T[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v as T[];
  return [];
}

/**
 * Deletes all `game_tags` rows and rebuilds from current `games` + `tags` rules.
 */
export async function rebuildGameTags(pool: Pool): Promise<{ inserted: number }> {
  const { rows: tagRows } = await pool.query<{ id: number; name: string; category: string }>(
    `SELECT id, name, category FROM tags`,
  );
  const tagIdByName = new Map<string, number>();
  for (const t of tagRows) {
    tagIdByName.set(t.name.toLowerCase(), t.id);
  }

  const { rows: games } = await pool.query<GameRow>(
    `SELECT id, year, metacritic, genres, rawg_tags FROM games`,
  );

  const pairs: { game_id: number; tag_id: number }[] = [];

  for (const game of games) {
    const seen = new Set<number>();
    const add = (tagName: string) => {
      const id = tagIdByName.get(tagName.toLowerCase());
      if (id != null && !seen.has(id)) {
        seen.add(id);
        pairs.push({ game_id: game.id, tag_id: id });
      }
    };

    const y = game.year;
    if (y != null) {
      if (y > 2015) add("Published after 2015");
      if (y > 2010) add("Published after 2010");
      if (y < 2005) add("Published before 2005");
    }

    if (game.metacritic != null && game.metacritic > 80) {
      add("Metacritic above 80");
    }

    for (const g of asArray<RawgGenre>(game.genres)) {
      if (!g?.name) continue;
      const mapped = mapRawgGenreToTagName(g);
      if (mapped) add(mapped);
    }

    for (const t of asArray<RawgTag>(game.rawg_tags)) {
      if (!t?.name) continue;
      const mapped = mapRawgGameTagToFeatureName(t.name);
      if (mapped) add(mapped);
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM game_tags`);
    let inserted = 0;
    if (pairs.length > 0) {
      const gameIds = pairs.map((p) => p.game_id);
      const tagIds = pairs.map((p) => p.tag_id);
      const r = await client.query(
        `INSERT INTO game_tags (game_id, tag_id)
         SELECT * FROM unnest($1::int[], $2::int[])
         ON CONFLICT DO NOTHING`,
        [gameIds, tagIds],
      );
      inserted = r.rowCount ?? 0;
    }
    await client.query("COMMIT");
    return { inserted };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

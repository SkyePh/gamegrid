/** RAWG API client + sync into `games`. */

import type { Pool } from "pg";
import { rebuildGameTags } from "./gameTags.js";

const RAWG_BASE = "https://api.rawg.io/api";

export type RawgListGame = {
  id: number;
  name: string;
  released: string | null;
  background_image: string | null;
  metacritic: number | null;
  developers?: { name: string }[];
  publishers?: { name: string }[];
  /** Present on `/games/{id}` — used for `games.genres` + `game_tags`. */
  genres?: { id?: number; name: string; slug?: string }[];
  /** RAWG "tags" on the game (features, themes); stored in `games.rawg_tags`. */
  tags?: { id?: number; name: string; slug?: string }[];
};

type RawgGamesResponse = {
  results: RawgListGame[];
};

function releaseYear(released: string | null): number | null {
  if (!released || released.length < 4) return null;
  const y = Number.parseInt(released.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

export async function fetchRawgGamesPage(
  apiKey: string,
  page: number,
  pageSize: number,
): Promise<RawgListGame[]> {
  const params = new URLSearchParams({
    key: apiKey,
    page: String(page),
    page_size: String(Math.min(pageSize, 40)),
    ordering: "-added",
  });
  const url = `${RAWG_BASE}/games?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`RAWG HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as RawgGamesResponse;
  return data.results ?? [];
}

export async function fetchTopRawgGames(apiKey: string, limit: number): Promise<RawgListGame[]> {
  const out: RawgListGame[] = [];
  let page = 1;
  const pageSize = 40;

  while (out.length < limit) {
    const batch = await fetchRawgGamesPage(apiKey, page, pageSize);
    if (batch.length === 0) break;
    for (const g of batch) {
      out.push(g);
      if (out.length >= limit) break;
    }
    page += 1;
    if (page > 50) break;
    await new Promise((r) => setTimeout(r, 120));
  }

  return out.slice(0, limit);
}

/** Single-game payload includes `developers` / `publishers`; the list endpoint usually omits them. */
export async function fetchRawgGameDetail(apiKey: string, id: number): Promise<RawgListGame> {
  const params = new URLSearchParams({ key: apiKey });
  const res = await fetch(`${RAWG_BASE}/games/${id}?${params}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`RAWG detail HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as RawgListGame;
}

/**
 * Fetches `/games/{id}` for each row so studio/publisher are filled.
 * ~300 detail calls: use modest concurrency + delay to stay within RAWG limits.
 */
export async function enrichGamesWithDetails(
  apiKey: string,
  games: RawgListGame[],
  concurrency = 5,
): Promise<RawgListGame[]> {
  const out = games.map((g) => ({ ...g }));
  let idx = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = idx++;
      if (i >= out.length) return;
      try {
        const detail = await fetchRawgGameDetail(apiKey, out[i].id);
        out[i] = {
          ...out[i],
          name: detail.name ?? out[i].name,
          released: detail.released ?? out[i].released,
          background_image: detail.background_image ?? out[i].background_image,
          metacritic: detail.metacritic ?? out[i].metacritic,
          developers: detail.developers?.length ? detail.developers : out[i].developers,
          publishers: detail.publishers?.length ? detail.publishers : out[i].publishers,
          genres: detail.genres?.length ? detail.genres : out[i].genres,
          tags: detail.tags?.length ? detail.tags : out[i].tags,
        };
      } catch {
        // keep list row as-is
      }
      await new Promise((r) => setTimeout(r, 80));
    }
  }

  const workers = Math.min(concurrency, Math.max(1, out.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

/** Re-fetch RAWG details for every row with `external_id` and update studio, publisher, genres, rawg_tags. */
export async function enrichExistingGamesFromRawg(
  pool: Pool,
  apiKey: string,
  rebuildTags = true,
): Promise<number> {
  const { rows } = await pool.query<{ external_id: number }>(
    `SELECT external_id FROM games WHERE external_id IS NOT NULL ORDER BY id`,
  );
  if (rows.length === 0) return 0;

  const stubs: RawgListGame[] = rows.map((r) => ({
    id: r.external_id,
    name: "",
    released: null,
    background_image: null,
    metacritic: null,
  }));

  const enriched = await enrichGamesWithDetails(apiKey, stubs);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let n = 0;
    for (const g of enriched) {
      const studio = g.developers?.[0]?.name ?? null;
      const publisher = g.publishers?.[0]?.name ?? null;
      const r = await client.query(
        `UPDATE games SET studio = $1, publisher = $2, genres = $3::jsonb, rawg_tags = $4::jsonb WHERE external_id = $5`,
        [studio, publisher, JSON.stringify(g.genres ?? []), JSON.stringify(g.tags ?? []), g.id],
      );
      n += r.rowCount ?? 0;
    }
    await client.query("COMMIT");
    if (rebuildTags) {
      await rebuildGameTags(pool);
    }
    return n;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function upsertGamesFromRawg(pool: Pool, games: RawgListGame[]): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let n = 0;
    for (const game of games) {
      const year = releaseYear(game.released);
      const studio = game.developers?.[0]?.name ?? null;
      const publisher = game.publishers?.[0]?.name ?? null;
      await client.query(
        `INSERT INTO games (title, year, studio, publisher, img_url, external_id, metacritic, genres, rawg_tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
         ON CONFLICT (external_id) DO UPDATE SET
           title = EXCLUDED.title,
           year = EXCLUDED.year,
           studio = EXCLUDED.studio,
           publisher = EXCLUDED.publisher,
           img_url = EXCLUDED.img_url,
           metacritic = EXCLUDED.metacritic,
           genres = EXCLUDED.genres,
           rawg_tags = EXCLUDED.rawg_tags`,
        [
          game.name,
          year,
          studio,
          publisher,
          game.background_image,
          game.id,
          game.metacritic,
          JSON.stringify(game.genres ?? []),
          JSON.stringify(game.tags ?? []),
        ],
      );
      n += 1;
    }
    await client.query("COMMIT");
    return n;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function syncTopRawgGames(
  pool: Pool,
  apiKey: string,
  limit: number,
  enrichDetails = true,
  rebuildTags = true,
): Promise<number> {
  const games = await fetchTopRawgGames(apiKey, limit);
  const ready = enrichDetails ? await enrichGamesWithDetails(apiKey, games) : games;
  const n = await upsertGamesFromRawg(pool, ready);
  if (rebuildTags) {
    await rebuildGameTags(pool);
  }
  return n;
}

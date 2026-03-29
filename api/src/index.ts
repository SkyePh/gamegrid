import "dotenv/config";
import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { loadEnv } from "./env.js";
import { createPool } from "./db.js";
import { runMigrations } from "./migrate.js";
import { enrichExistingGamesFromRawg, syncTopRawgGames } from "./rawg.js";
import { rebuildGameTags } from "./gameTags.js";

const env = loadEnv();
const pool = createPool(env);
await runMigrations(pool);

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

app.get("/health", async (c) => {
  try {
    await pool.query("SELECT 1");
    return c.json({
      ok: true,
      db: true,
      rawgConfigured: Boolean(env.RAWG_API_KEY && env.RAWG_API_KEY.length > 0),
    });
  } catch {
    return c.json({ ok: false, db: false }, 503);
  }
});

app.get("/tags", async (c) => {
  try {
    const result = await pool.query<{ id: number; name: string; category: string }>(
      `SELECT id, name, category FROM tags ORDER BY category, name`,
    );
    return c.json({ tags: result.rows });
  } catch {
    return c.json({ error: "database_unavailable" }, 503);
  }
});

/** Substring search on `games.title` (case-insensitive). Pick a row so the title is always canonical from DB. */
app.get("/games/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const limitRaw = Number(c.req.query("limit") ?? 20);
  const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, Math.floor(limitRaw))) : 20;
  if (q.length === 0) {
    return c.json({ games: [] as { id: number; title: string; year: number | null; img_url: string | null }[] });
  }
  try {
    const result = await pool.query<{ id: number; title: string; year: number | null; img_url: string | null }>(
      `SELECT id, title, year, img_url
       FROM games
       WHERE position(lower($1) IN lower(title)) > 0
       ORDER BY title ASC
       LIMIT $2`,
      [q, limit],
    );
    return c.json({ games: result.rows });
  } catch {
    return c.json({ error: "database_unavailable" }, 503);
  }
});

const validateCellSchema = z.object({
  gameId: z.number().int().positive(),
  rowTag: z.string().min(1),
  colTag: z.string().min(1),
});

/** True if `game_tags` links this game to both tag names (row ∩ column). */
app.post("/validate-cell", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const parsed = validateCellSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", details: parsed.error.flatten() }, 400);
  }
  const { gameId, rowTag, colTag } = parsed.data;
  try {
    const t = await pool.query<{ id: number; name: string }>(
      `SELECT id, name FROM tags WHERE name = $1 OR name = $2`,
      [rowTag, colTag],
    );
    const rowTagId = t.rows.find((r) => r.name === rowTag)?.id;
    const colTagId = t.rows.find((r) => r.name === colTag)?.id;
    if (rowTagId == null || colTagId == null) {
      return c.json({ valid: false, reason: "unknown_tag" as const });
    }
    const r = await pool.query<{ n: string }>(
      `SELECT COUNT(DISTINCT tag_id)::text AS n
       FROM game_tags
       WHERE game_id = $1 AND tag_id IN ($2, $3)`,
      [gameId, rowTagId, colTagId],
    );
    const n = Number(r.rows[0]?.n ?? 0);
    const valid = n === 2;
    return c.json({ valid, reason: valid ? undefined : ("missing_tags" as const) });
  } catch {
    return c.json({ error: "database_unavailable" }, 503);
  }
});

const syncBodySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional().default(300),
  /** Per-game `/games/{id}` calls so studio/publisher are filled (slower, ~1–3 min for 300). Default true. */
  enrichDetails: z.boolean().optional().default(true),
  /** Only re-fetch details for rows already in DB; updates studio/publisher. No list fetch. */
  enrichExistingOnly: z.boolean().optional().default(false),
  /** Rebuild `game_tags` from `games` + rules after sync. Default true. */
  rebuildGameTags: z.boolean().optional().default(true),
});

/**
 * Fetches top games from RAWG and upserts into `games`.
 * With enrichDetails (default), calls `/games/{id}` per game so developers/publishers are stored.
 */
app.post("/sync/rawg-top-games", async (c) => {
  const key = env.RAWG_API_KEY;
  if (!key) {
    return c.json({ error: "rawg_api_key_missing" }, 400);
  }
  const raw = await c.req.json().catch(() => ({}));
  const parsed = syncBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", details: parsed.error.flatten() }, 400);
  }
  const { limit, enrichDetails, enrichExistingOnly, rebuildGameTags: doRebuildTags } = parsed.data;
  try {
    if (enrichExistingOnly) {
      const updated = await enrichExistingGamesFromRawg(pool, key, doRebuildTags);
      return c.json({ ok: true, updated, mode: "enrich_existing", rebuildGameTags: doRebuildTags });
    }
    const upserted = await syncTopRawgGames(pool, key, limit, enrichDetails, doRebuildTags);
    return c.json({
      ok: true,
      upserted,
      requested: limit,
      enrichDetails,
      rebuildGameTags: doRebuildTags,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "sync_failed";
    console.error(err);
    return c.json({ ok: false, error: message }, 502);
  }
});

/** Recompute all `game_tags` from `games.genres`, `games.rawg_tags`, year, metacritic. */
app.post("/sync/rebuild-game-tags", async (c) => {
  try {
    const { inserted } = await rebuildGameTags(pool);
    return c.json({ ok: true, inserted });
  } catch (err) {
    const message = err instanceof Error ? err.message : "rebuild_failed";
    console.error(err);
    return c.json({ ok: false, error: message }, 502);
  }
});

const port = env.PORT;
const server = createAdaptorServer({ fetch: app.fetch, port });

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${port} is already in use (another gamegrid-api or app). Stop it or set PORT in .env. Hint: lsof -iTCP:${port} -sTCP:LISTEN`,
    );
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(port, () => {
  console.log(`gamegrid-api listening on http://localhost:${port}`);
});

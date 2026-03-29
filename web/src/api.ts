const base = (import.meta.env.VITE_API_URL ?? "http://localhost:3001").replace(/\/$/, "");

export type GameSearchRow = {
  id: number;
  title: string;
  year: number | null;
  img_url: string | null;
};

export async function searchGames(q: string, limit = 20): Promise<GameSearchRow[]> {
  const u = new URL(`${base}/games/search`);
  u.searchParams.set("q", q);
  u.searchParams.set("limit", String(limit));
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error("search_failed");
  const data = (await res.json()) as { games: GameSearchRow[] };
  return data.games ?? [];
}

export async function validateCell(
  gameId: number,
  rowTag: string,
  colTag: string,
): Promise<{ valid: boolean }> {
  const res = await fetch(`${base}/validate-cell`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, rowTag, colTag }),
  });
  if (!res.ok) throw new Error("validate_failed");
  return (await res.json()) as { valid: boolean };
}

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { searchGames, validateCell, type GameSearchRow } from "./api";

/** Hardcoded puzzle: row tag × column tag → one picked game each (DB title). */
const ROW_TAGS = ["RPG", "Indie", "FPS"] as const;
const COL_TAGS = [
  "Published after 2015",
  "Open world",
  "Metacritic above 80",
] as const;

type CellKey = `${number}-${number}`;

type CellPick = { id: number; title: string; imgUrl: string | null } | null;

function emptyCells(): Record<CellKey, CellPick> {
  const m = {} as Record<CellKey, CellPick>;
  for (let r = 0; r < ROW_TAGS.length; r++) {
    for (let c = 0; c < COL_TAGS.length; c++) {
      m[`${r}-${c}`] = null;
    }
  }
  return m;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function App() {
  const [cells, setCells] = useState(emptyCells);
  const [active, setActive] = useState<{ r: number; c: number } | null>(null);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query, 280);
  const [results, setResults] = useState<GameSearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [pickLoading, setPickLoading] = useState(false);
  const modalInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descId = useId();

  /** Game IDs already placed in other cells (current modal cell excluded). */
  const gameIdsUsedElsewhere = useMemo(() => {
    const s = new Set<number>();
    if (!active) return s;
    for (let r = 0; r < ROW_TAGS.length; r++) {
      for (let c = 0; c < COL_TAGS.length; c++) {
        if (r === active.r && c === active.c) continue;
        const p = cells[`${r}-${c}` as CellKey];
        if (p) s.add(p.id);
      }
    }
    return s;
  }, [cells, active]);

  const searchResultsVisible = useMemo(
    () => results.filter((g) => !gameIdsUsedElsewhere.has(g.id)),
    [results, gameIdsUsedElsewhere],
  );

  const openCell = useCallback((r: number, c: number) => {
    setActive({ r, c });
    setQuery("");
    setResults([]);
    setSearchError(false);
    setPickError(null);
  }, []);

  const closeModal = useCallback(() => {
    setActive(null);
    setQuery("");
    setResults([]);
    setSearchError(false);
    setPickError(null);
    setPickLoading(false);
  }, []);

  useEffect(() => {
    if (!active) return;
    const t = requestAnimationFrame(() => modalInputRef.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const q = debouncedQuery.trim();
    if (q.length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSearchError(false);
    searchGames(q)
      .then((games) => {
        if (!cancelled) setResults(games);
      })
      .catch(() => {
        if (!cancelled) {
          setResults([]);
          setSearchError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, active]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, closeModal]);

  const pickGame = useCallback(
    async (game: GameSearchRow) => {
      if (!active) return;
      setPickError(null);
      setPickLoading(true);
      try {
        if (gameIdsUsedElsewhere.has(game.id)) {
          setPickError("You already used this game in another square.");
          return;
        }
        const { valid } = await validateCell(game.id, ROW_TAGS[active.r], COL_TAGS[active.c]);
        if (!valid) {
          setPickError("That game doesn't match both this row and column.");
          return;
        }
        const key = `${active.r}-${active.c}` as CellKey;
        setCells((prev) => ({
          ...prev,
          [key]: { id: game.id, title: game.title, imgUrl: game.img_url },
        }));
        closeModal();
      } catch {
        setPickError("Couldn't validate. Check the API and try again.");
      } finally {
        setPickLoading(false);
      }
    },
    [active, closeModal, gameIdsUsedElsewhere],
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-10 sm:px-6">
      <header className="mb-10 text-center">
        <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
          GameGrid
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Tap a cell, then search and pick a game — each title can only be used once.
        </p>
      </header>

      <div className="flex-1 overflow-x-auto">
        <div
          className="inline-grid min-w-full gap-px rounded-xl bg-zinc-800/80 p-px shadow-xl ring-1 ring-white/5"
          style={{
            gridTemplateColumns: `minmax(7rem,10rem) repeat(${COL_TAGS.length}, minmax(9rem, 1fr))`,
          }}
        >
          <div className="rounded-tl-lg bg-zinc-900/90 p-3" aria-hidden="true" />

          {COL_TAGS.map((label, c) => (
            <div
              key={label}
              className={`bg-gradient-to-b from-emerald-950/80 to-zinc-900/90 px-3 py-3 text-center sm:px-4 ${
                c === COL_TAGS.length - 1 ? "rounded-tr-lg" : ""
              }`}
            >
              <span className="text-[11px] font-medium uppercase tracking-wider text-emerald-400/90">
                Column
              </span>
              <p className="mt-1 font-display text-xs font-semibold leading-snug text-emerald-100 sm:text-sm">
                {label}
              </p>
            </div>
          ))}

          {ROW_TAGS.map((rowLabel, r) => (
            <div key={rowLabel} className="contents">
              <div
                className={`flex flex-col justify-center bg-gradient-to-r from-violet-950/80 to-zinc-900/90 px-3 py-3 sm:px-4 ${
                  r === ROW_TAGS.length - 1 ? "rounded-bl-lg" : ""
                }`}
              >
                <span className="text-[11px] font-medium uppercase tracking-wider text-violet-400/90">
                  Row
                </span>
                <p className="mt-1 font-display text-xs font-semibold leading-snug text-violet-100 sm:text-sm">
                  {rowLabel}
                </p>
              </div>

              {COL_TAGS.map((_, c) => {
                const key = `${r}-${c}` as CellKey;
                const pick = cells[key] ?? null;
                return (
                  <div
                    key={key}
                    className={`bg-zinc-900/95 p-2 shadow-cell ${
                      r === ROW_TAGS.length - 1 && c === COL_TAGS.length - 1 ? "rounded-br-lg" : ""
                    } `}
                  >
                    {pick ? (
                      <div
                        className="flex min-h-[4.5rem] w-full cursor-default flex-col items-center justify-center rounded-lg border border-emerald-500/45 bg-gradient-to-b from-emerald-950/70 to-emerald-950/40 px-2 py-3 text-center shadow-[inset_0_1px_0_0_rgba(52,211,153,0.12)] ring-1 ring-emerald-500/15"
                        title="Correct — locked"
                      >
                        {pick.imgUrl ? (
                          <img
                            src={pick.imgUrl}
                            alt=""
                            className="mb-1.5 h-10 w-10 rounded object-cover ring-1 ring-emerald-500/25"
                          />
                        ) : (
                          <span className="mb-1.5 flex h-10 w-10 items-center justify-center rounded bg-emerald-950/80 text-lg text-emerald-400/90 ring-1 ring-emerald-500/20">
                            ◆
                          </span>
                        )}
                        <span className="line-clamp-2 text-xs font-medium leading-snug text-emerald-100">
                          {pick.title}
                        </span>
                        <span className="mt-1.5 text-[10px] font-medium uppercase tracking-wide text-emerald-500/90">
                          Guessed
                        </span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openCell(r, c)}
                        className="flex min-h-[4.5rem] w-full flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700/90 bg-zinc-950/50 px-2 py-3 text-center transition hover:border-emerald-500/40 hover:bg-zinc-900/80 focus:outline-none focus:ring-2 focus:ring-emerald-500/35"
                      >
                        <span className="text-xs text-zinc-500">Choose game</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {active ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-700/80 bg-zinc-900 shadow-2xl"
          >
            <div className="border-b border-zinc-800 px-4 py-3 sm:px-5">
              <h2 id={titleId} className="font-display text-lg font-semibold text-white">
                Choose a game
              </h2>
              <p id={descId} className="mt-1 text-sm text-zinc-400">
                <span className="text-violet-300">{ROW_TAGS[active.r]}</span>
                <span className="text-zinc-600"> · </span>
                <span className="text-emerald-300">{COL_TAGS[active.c]}</span>
                <span className="mt-1 block text-xs text-zinc-500">
                  Games already placed elsewhere are hidden from search.
                </span>
              </p>
            </div>

            <div className="border-b border-zinc-800 px-4 py-3 sm:px-5">
              <input
                ref={modalInputRef}
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPickError(null);
                }}
                placeholder="Search games…"
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
              />
              {searchError ? (
                <p className="mt-2 text-xs text-red-400">Could not reach the API. Is it running?</p>
              ) : null}
              {pickError ? (
                <p className="mt-2 text-xs text-amber-400" role="alert">
                  {pickError}
                </p>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 sm:px-3">
              {pickLoading ? (
                <p className="px-2 py-4 text-center text-sm text-zinc-400">Checking…</p>
              ) : loading ? (
                <p className="px-2 py-6 text-center text-sm text-zinc-500">Searching…</p>
              ) : query.trim().length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-zinc-500">Type to search your library.</p>
              ) : results.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-zinc-500">No matches.</p>
              ) : searchResultsVisible.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-zinc-500">
                  All matching games are already placed in another square.
                </p>
              ) : (
                <ul className="space-y-1">
                  {searchResultsVisible.map((g) => (
                    <li key={g.id}>
                      <button
                        type="button"
                        disabled={pickLoading}
                        onClick={() => void pickGame(g)}
                        className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition hover:bg-zinc-800/90 focus:bg-zinc-800/90 focus:outline-none disabled:pointer-events-none disabled:opacity-40"
                      >
                        {g.img_url ? (
                          <img
                            src={g.img_url}
                            alt=""
                            className="h-11 w-11 shrink-0 rounded object-cover"
                          />
                        ) : (
                          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded bg-zinc-800 text-zinc-500">
                            ◆
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-zinc-100">{g.title}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-zinc-800 px-4 py-3 sm:px-5">
              <button
                type="button"
                onClick={closeModal}
                className="w-full rounded-lg border border-zinc-700 py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <footer className="mt-10 text-center text-xs text-zinc-600">
        Picks are validated against your game library tags
      </footer>
    </div>
  );
}

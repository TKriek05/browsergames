// Party lobby rules, shared by server (enforces) and client (explains):
// which games fit the people in the room, random draws and tournament
// scoring. Pure functions and plain data only.
import { CATALOG, getGame } from './catalog.js';

export const PARTY_MODES = ['free', 'random', 'tournament'];
export const PARTY_MODE_LABELS = { free: 'Vrije keuze', random: 'Willekeurig', tournament: 'Toernooi' };
export const TOURNAMENT_LENGTHS = [3, 5, 7, 10];
export const TOURNAMENT_ORDERS = ['random', 'host'];
export const DEFAULT_PARTY = Object.freeze({ mode: 'free', order: 'random', length: 5 });

export function availableGameIds() {
  return Object.values(CATALOG).filter((g) => g.available).map((g) => g.id);
}

// Keeps known, playable, unique ids. Returns null when nothing usable is left.
export function cleanPool(ids) {
  if (!Array.isArray(ids)) return null;
  const out = [...new Set(ids.filter((id) => getGame(id)?.available))];
  return out.length ? out : null;
}

// Does a game suit this group? `humans` = people who want to play, `bots` =
// bots in the room (they fill up seats, but never push a human out).
export function gameFits(game, humans, bots) {
  if (!game) return false;
  return game.max >= humans && game.min <= humans + (game.bots ? bots : 0);
}

// A random game from the pool: preferably one that fits and is not in
// `exclude` (the current game, games already played in the tournament).
// Falls back step by step so there is always an answer when the pool has one.
export function drawGame(pool, { humans = 1, bots = 0, exclude = [], rng = Math.random } = {}) {
  const ids = (pool ?? []).filter((id) => getGame(id)?.available);
  const tiers = [
    (g) => gameFits(g, humans, bots),
    (g) => g.max >= humans,
    () => true,
  ];
  for (const ok of tiers) {
    const candidates = ids.filter((id) => ok(getGame(id)));
    if (!candidates.length) continue;
    const fresh = candidates.filter((id) => !exclude.includes(id));
    const list = fresh.length ? fresh : candidates;
    return list[Math.floor(rng() * list.length)] ?? list[0];
  }
  return null;
}

// --- Tournament -----------------------------------------------------------------------
// Every finished game counts. A win (rank 1) is what matters; placement
// points (n-1 for first … 0 for last) break ties. When everybody shares the
// same rank (a draw) nobody gets the win.
export function newTournament(length) {
  return { length, played: 0, done: false, games: [], standings: {} };
}

export function scoreGame(t, gameId, results) {
  const rows = results?.rows ?? [];
  const n = rows.length;
  const allTied = n > 1 && rows.every((r) => r.rank === rows[0].rank);
  const winners = allTied ? [] : rows.filter((r) => r.rank === 1).map((r) => r.id);
  for (const r of rows) {
    const s = (t.standings[r.id] ??= { id: r.id, name: r.name, color: r.color, wins: 0, points: 0, played: 0 });
    s.name = r.name;
    s.color = r.color;
    s.played++;
    if (winners.includes(r.id)) s.wins++;
    s.points += Math.max(0, n - r.rank);
  }
  t.games.push({ game: gameId, winners });
  t.played++;
  t.done = t.played >= t.length;
  return winners;
}

export function sortStandings(standings) {
  return Object.values(standings).sort((a, b) => b.wins - a.wins || b.points - a.points || a.name.localeCompare(b.name));
}

// Everyone sharing the top spot (same wins and points).
export function champions(standings) {
  const sorted = sortStandings(standings);
  const top = sorted[0];
  if (!top || top.played === 0) return [];
  return sorted.filter((s) => s.wins === top.wins && s.points === top.points);
}

// Public form for the room state.
export function tournamentView(t) {
  if (!t) return null;
  return {
    length: t.length,
    played: t.played,
    done: t.done,
    games: t.games.map((g) => ({ game: g.game, winners: [...g.winners] })),
    standings: sortStandings(t.standings).map((s) => ({ ...s })),
  };
}

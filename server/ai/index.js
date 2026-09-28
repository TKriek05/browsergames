// Entry point for bot moves: light engines run inline, heavy ones in the
// worker pool. Always resolves; on errors/timeouts the caller gets null and
// falls back to a random legal move.
import { ENGINES } from './engines.js';
import { AiPool } from './pool.js';

// Extra time on top of an engine's own budget before we kill the worker.
const TIMEOUT_MARGIN_MS = 1500;

let pool = null;

export function hasEngine(gameId) {
  return Object.hasOwn(ENGINES, gameId);
}

export async function chooseMove(gameId, state, seat, level) {
  const engine = ENGINES[gameId];
  if (!engine) return null;
  try {
    if (!engine.worker) return engine.pick(state, seat, level, Math.random);
    pool ??= new AiPool();
    return await pool.run({ gameId, state, seat, level }, (engine.budgetMs?.[level] ?? 1000) + TIMEOUT_MARGIN_MS);
  } catch {
    return null;
  }
}

export function shutdownAi() {
  pool?.terminate();
  pool = null;
}

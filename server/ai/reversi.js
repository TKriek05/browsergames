// Reversi bot: alpha-beta with positional weights, mobility and corners;
// near the end it simply counts discs.
import rules, { movesFor, count } from '../../shared/rules/reversi.js';
import { searchBestMove, pickWithLevel } from './search.js';

const LEVELS = {
  easy: { depth: 1, timeMs: 150, blunder: 0.35 },
  normal: { depth: 3, timeMs: 500, blunder: 0.05 },
  hard: { depth: 7, timeMs: 1400, blunder: 0 },
};

// Classic weight table: corners good, squares next to corners bad.
const WEIGHTS = [
  100, -20, 10, 5, 5, 10, -20, 100,
  -20, -50, -2, -2, -2, -2, -50, -20,
  10, -2, 1, 1, 1, 1, -2, 10,
  5, -2, 1, 0, 0, 1, -2, 5,
  5, -2, 1, 0, 0, 1, -2, 5,
  10, -2, 1, 1, 1, 1, -2, 10,
  -20, -50, -2, -2, -2, -2, -50, -20,
  100, -20, 10, 5, 5, 10, -20, 100,
];

function evaluate(state, me) {
  const b = state.board;
  const opp = 1 - me;
  const [c0, c1] = count(b);
  const empties = 64 - c0 - c1;
  const discDiff = me === 0 ? c0 - c1 : c1 - c0;
  if (empties <= 10) return discDiff * 10;
  let pos = 0;
  for (let i = 0; i < 64; i++) {
    if (b[i] === me) pos += WEIGHTS[i];
    else if (b[i] === opp) pos -= WEIGHTS[i];
  }
  const mobility = movesFor(b, me).length - movesFor(b, opp).length;
  return pos + mobility * 6;
}

// Corners first, then by weight: better pruning.
const order = (moves) => [...moves].sort((a, b) => WEIGHTS[b.sq] - WEIGHTS[a.sq]);

export default {
  worker: true,
  budgetMs: { easy: LEVELS.easy.timeMs, normal: LEVELS.normal.timeMs, hard: LEVELS.hard.timeMs },
  pick(state, seat, level, rng) {
    const cfg = LEVELS[level] ?? LEVELS.normal;
    const legal = rules.legalMoves(state, seat);
    const best = searchBestMove(rules, state, seat, { maxDepth: cfg.depth, timeMs: cfg.timeMs, evaluate, order });
    return pickWithLevel(best, legal, rng, cfg.blunder);
  },
};

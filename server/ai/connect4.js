// Connect four bot: alpha-beta over the rules module with a window heuristic.
import rules, { COLS, ROWS } from '../../shared/rules/connect4.js';
import { searchBestMove, pickWithLevel } from './search.js';

const LEVELS = {
  easy: { depth: 2, timeMs: 150, blunder: 0.3 },
  normal: { depth: 5, timeMs: 500, blunder: 0.06 },
  hard: { depth: 12, timeMs: 1400, blunder: 0 },
};
const ORDER = [3, 2, 4, 1, 5, 0, 6]; // centre first = better pruning

// All windows of four cells, computed once.
const WINDOWS = [];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const cells = [];
      for (let i = 0; i < 4; i++) {
        const rr = r + dr * i;
        const cc = c + dc * i;
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) break;
        cells.push(rr * COLS + cc);
      }
      if (cells.length === 4) WINDOWS.push(cells);
    }
  }
}

function evaluate(state, me) {
  const b = state.board;
  const opp = 1 - me;
  let score = 0;
  for (let r = 0; r < ROWS; r++) {
    const v = b[r * COLS + 3];
    if (v === me) score += 3;
    else if (v === opp) score -= 3;
  }
  for (const w of WINDOWS) {
    let mine = 0;
    let theirs = 0;
    for (const i of w) {
      if (b[i] === me) mine++;
      else if (b[i] === opp) theirs++;
    }
    if (mine && theirs) continue;
    if (mine === 3) score += 12;
    else if (mine === 2) score += 3;
    if (theirs === 3) score -= 14;
    else if (theirs === 2) score -= 3;
  }
  return score;
}

const order = (moves) => [...moves].sort((a, b) => ORDER.indexOf(a.col) - ORDER.indexOf(b.col));

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

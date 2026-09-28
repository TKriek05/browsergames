// Dammen bot: negamax with alpha-beta on raw boards (faster than going
// through the rules module), a capture extension so it never stops halfway
// an exchange, and an evaluation for material, advancement and structure.
import { generateMoves, rc, owner, isKing, EMPTY, WM, WK, BM, BK } from '../../shared/rules/checkers.js';

const LEVELS = {
  easy: { depth: 2, timeMs: 200, blunder: 0.25 },
  normal: { depth: 4, timeMs: 700, blunder: 0.04 },
  hard: { depth: 14, timeMs: 1500, blunder: 0 },
};
const WIN = 100000;
const MAN = 100;
const KING = 320;
const MAX_EXTENSION = 6;
const TIMEOUT = Symbol('timeout');

function play(board, move) {
  const b = board.slice();
  const from = move.path[0];
  const to = move.path[move.path.length - 1];
  let p = b[from];
  b[from] = EMPTY;
  for (const c of move.caps) b[c] = EMPTY;
  const row = rc(to)[0];
  if (p === WM && row === 0) p = WK;
  if (p === BM && row === 9) p = BK;
  b[to] = p;
  return b;
}

// Score from `seat`'s point of view.
function evaluate(board, seat) {
  let score = 0;
  for (let sq = 0; sq < 50; sq++) {
    const p = board[sq];
    if (p === EMPTY) continue;
    const [r, c] = rc(sq);
    let v;
    if (isKing(p)) v = KING;
    else {
      const advance = owner(p) === 0 ? 9 - r : r; // rows travelled towards promotion
      v = MAN + advance * 4 + (c >= 3 && c <= 6 ? 6 : 0);
      if ((owner(p) === 0 && r === 9) || (owner(p) === 1 && r === 0)) v += 8; // back rank guard
    }
    score += owner(p) === seat ? v : -v;
  }
  return score;
}

export default {
  worker: true,
  budgetMs: { easy: LEVELS.easy.timeMs, normal: LEVELS.normal.timeMs, hard: LEVELS.hard.timeMs },

  pick(state, seat, level, rng) {
    const cfg = LEVELS[level] ?? LEVELS.normal;
    let rootMoves = generateMoves(state.board, seat);
    if (rootMoves.length <= 1) return rootMoves[0] ?? null;
    if (rng() < cfg.blunder) return rootMoves[Math.floor(rng() * rootMoves.length)];

    const deadline = performance.now() + cfg.timeMs;
    let nodes = 0;

    const negamax = (board, side, depth, ply, alpha, beta, ext) => {
      if ((++nodes & 1023) === 0 && performance.now() > deadline) throw TIMEOUT;
      const moves = generateMoves(board, side);
      if (!moves.length) return -WIN + ply;
      const capturing = moves[0].caps.length > 0;
      // Keep searching while captures are forced (up to a limit).
      if (depth <= 0 && !(capturing && ext < MAX_EXTENSION)) return evaluate(board, side);
      const nextExt = depth <= 0 ? ext + 1 : ext;
      let best = -Infinity;
      for (const m of moves) {
        const score = -negamax(play(board, m), 1 - side, depth - 1, ply + 1, -beta, -alpha, nextExt);
        if (score > best) best = score;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    };

    let bestMove = rootMoves[0];
    for (let depth = 1; depth <= cfg.depth; depth++) {
      try {
        let alpha = -Infinity;
        let iterBest = rootMoves[0];
        for (const m of rootMoves) {
          const score = -negamax(play(state.board, m), 1 - seat, depth - 1, 1, -Infinity, -alpha, 0);
          if (score > alpha) {
            alpha = score;
            iterBest = m;
          }
        }
        bestMove = iterBest;
        rootMoves = [iterBest, ...rootMoves.filter((m) => m !== iterBest)];
        if (alpha > WIN - 1000) break;
      } catch (err) {
        if (err !== TIMEOUT) throw err;
        break;
      }
    }
    return bestMove;
  },
};

// Dammen voor 4 bot: a small max-n search (every player picks the move that
// is best for themselves), with a time budget. The evaluation counts
// material and how far the men have come, relative to the others.
// Easy bots look one move ahead and sometimes blunder; hard bots look up to
// six plies ahead (iterative deepening within their time budget).
import { generateMoves, playMove, pieceArm, isKing, rcOf, SQUARES, SIZE, EMPTY } from '../../shared/rules/checkers4.js';

const LEVELS = {
  easy: { depth: 1, timeMs: 120, blunder: 0.25 },
  normal: { depth: 3, timeMs: 500, blunder: 0.03 },
  hard: { depth: 6, timeMs: 1200, blunder: 0 },
};
const MAN = 100;
const KING = 300;
const TIMEOUT = Symbol('timeout');

// How far a man of `arm` has come (0 … 1).
function progress(arm, i) {
  const [r, c] = rcOf(i);
  const d = arm === 0 ? SIZE - 1 - r : arm === 1 ? c : arm === 2 ? r : SIZE - 1 - c;
  return d / (SIZE - 1);
}

// Score per arm (index = arm) for a board.
function evaluate(board, arms) {
  const score = [0, 0, 0, 0];
  for (const i of SQUARES) {
    const p = board[i];
    if (p === EMPTY) continue;
    const a = pieceArm(p);
    score[a] += isKing(p) ? KING : MAN + progress(a, i) * 30;
  }
  // Relative: your own score minus the average of the others still in.
  const inPlay = arms.filter((a) => score[a] > 0);
  const total = inPlay.reduce((n, a) => n + score[a], 0);
  const out = [0, 0, 0, 0];
  for (const a of arms) out[a] = score[a] > 0 ? score[a] - (total - score[a]) / Math.max(1, inPlay.length - 1) : -1e6;
  return out;
}

export default {
  worker: true,
  budgetMs: { easy: LEVELS.easy.timeMs, normal: LEVELS.normal.timeMs, hard: LEVELS.hard.timeMs },

  pick(state, seat, level, rng) {
    const cfg = LEVELS[level] ?? LEVELS.normal;
    const arms = state.arms;
    const out = new Set(state.out);
    const myArm = arms[seat];
    const moves = generateMoves(state.board, myArm);
    if (moves.length <= 1) return moves[0] ?? null;
    if (rng() < cfg.blunder) return moves[Math.floor(rng() * moves.length)];
    const deadline = performance.now() + cfg.timeMs;
    let nodes = 0;

    const nextSeat = (s) => {
      for (let k = 1; k <= arms.length; k++) {
        const n = (s + k) % arms.length;
        if (!out.has(n)) return n;
      }
      return s;
    };

    // Max-n: returns the score vector after best play to `depth`.
    const search = (board, s, depth) => {
      if ((++nodes & 255) === 0 && performance.now() > deadline) throw TIMEOUT;
      if (depth === 0) return evaluate(board, arms);
      const list = generateMoves(board, arms[s]);
      if (!list.length) return evaluate(board, arms);
      let best = null;
      for (const m of list) {
        const v = search(playMove(board, m).board, nextSeat(s), depth - 1);
        if (!best || v[arms[s]] > best[arms[s]]) best = v;
      }
      return best;
    };

    let bestMove = moves[Math.floor(rng() * moves.length)];
    for (let depth = 1; depth <= cfg.depth; depth++) {
      try {
        let bestScore = -Infinity;
        let iterBest = bestMove;
        for (const m of moves) {
          const v = search(playMove(state.board, m).board, nextSeat(seat), depth - 1);
          const score = v[myArm] + rng() * 2; // a little variety between equal moves
          if (score > bestScore) {
            bestScore = score;
            iterBest = m;
          }
        }
        bestMove = iterBest;
      } catch (err) {
        if (err !== TIMEOUT) throw err;
        break;
      }
    }
    return bestMove;
  },
};

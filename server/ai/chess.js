// Chess engine for the bots: negamax + alpha-beta, iterative deepening with a
// time budget, quiescence search on captures, MVV-LVA + killer move ordering
// and a piece-square-table evaluation. Runs in a worker thread.
import {
  Position, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE,
  moveFrom, moveTo, moveFlags, movePromo, F_CAPTURE, F_PROMO,
} from '../../shared/chess/position.js';
import { toWire } from '../../shared/rules/chess.js';

const LEVELS = {
  easy: { depth: 1, timeMs: 150, noise: 120 }, // noise in centipawns: makes human-like mistakes
  normal: { depth: 3, timeMs: 700, noise: 25 },
  hard: { depth: 30, timeMs: 1500, noise: 0 },
};
const VALUE = [0, 100, 320, 330, 500, 900, 0];
const MATE = 100000;
const TIMEOUT = Symbol('timeout');

// Piece-square tables from white's point of view, a8 first (row 0 = rank 8).
const PST = {
  [PAWN]: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0],
  [KNIGHT]: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50],
  [BISHOP]: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20],
  [ROOK]: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0],
  [QUEEN]: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20],
  [KING]: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20],
};
// King in the endgame: walk to the centre.
const KING_END = [
  -50, -40, -30, -20, -20, -30, -40, -50,
  -30, -20, -10, 0, 0, -10, -20, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -30, 0, 0, 0, 0, -30, -30,
  -50, -30, -30, -30, -30, -30, -30, -50];

// Index into the tables for a 0x88 square, seen from `white`.
const pstIndex = (sq, white) => (white ? (7 - (sq >> 4)) * 8 + (sq & 7) : (sq >> 4) * 8 + (sq & 7));

// Static evaluation from the side to move's point of view.
function evaluate(pos) {
  const b = pos.board;
  let score = 0;
  let material = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const t = Math.abs(b[sq]);
    if (t && t !== PAWN && t !== KING) material += VALUE[t];
  }
  const endgame = material <= 1300;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = b[sq];
    if (!p) continue;
    const t = Math.abs(p);
    const white = p > 0;
    const table = t === KING && endgame ? KING_END : PST[t];
    const v = VALUE[t] + table[pstIndex(sq, white)];
    score += white ? v : -v;
  }
  return pos.side === WHITE ? score : -score;
}

// exactRoot: search every root move with a full window so its score is exact
// (needed when a weaker level picks among "almost best" moves).
export function searchChess(fen, { depth: maxDepth, timeMs, exactRoot = false }) {
  const pos = new Position(fen);
  const deadline = performance.now() + timeMs;
  const killers = [];
  let nodes = 0;

  const orderScore = (m, ply) => {
    const flags = moveFlags(m);
    if (flags & F_CAPTURE) {
      const victim = Math.abs(pos.board[moveTo(m)]) || PAWN;
      const attacker = Math.abs(pos.board[moveFrom(m)]);
      return 10000 + VALUE[victim] * 10 - VALUE[attacker];
    }
    if (flags & F_PROMO) return 9000 + VALUE[movePromo(m)];
    if (killers[ply] === m) return 5000;
    return 0;
  };
  const sortMoves = (moves, ply, first = 0) => {
    const scored = moves.map((m) => [m === first ? 1e9 : orderScore(m, ply), m]);
    scored.sort((a, b) => b[0] - a[0]);
    return scored.map((x) => x[1]);
  };

  const quiesce = (alpha, beta, ply) => {
    if ((++nodes & 2047) === 0 && performance.now() > deadline) throw TIMEOUT;
    const stand = evaluate(pos);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    for (const m of sortMoves(pos.pseudoMoves([], true), ply)) {
      pos.make(m);
      if (pos.inCheck(1 - pos.side)) { pos.unmake(); continue; }
      const score = -quiesce(-beta, -alpha, ply + 1);
      pos.unmake();
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  };

  const negamax = (depth, alpha, beta, ply) => {
    if ((++nodes & 2047) === 0 && performance.now() > deadline) throw TIMEOUT;
    if (pos.halfmove >= 100) return 0;
    const inCheck = pos.inCheck();
    if (depth <= 0 && !inCheck) return quiesce(alpha, beta, ply);
    let legal = 0;
    for (const m of sortMoves(pos.pseudoMoves(), ply)) {
      pos.make(m);
      if (pos.inCheck(1 - pos.side)) { pos.unmake(); continue; }
      legal++;
      const score = -negamax(depth - 1, -beta, -alpha, ply + 1);
      pos.unmake();
      if (score >= beta) {
        if (!(moveFlags(m) & F_CAPTURE)) killers[ply] = m;
        return beta;
      }
      if (score > alpha) alpha = score;
    }
    if (!legal) return inCheck ? -MATE + ply : 0;
    return alpha;
  };

  let rootMoves = pos.legalMoves();
  if (!rootMoves.length) return { move: 0, scores: [] };
  let best = { move: rootMoves[0], scores: rootMoves.map((m) => [m, 0]), depth: 0 };
  for (let depth = 1; depth <= maxDepth; depth++) {
    try {
      const scores = [];
      let alpha = -Infinity;
      let bestMove = rootMoves[0];
      for (const m of sortMoves(rootMoves, 0, best.move)) {
        pos.make(m);
        const score = -negamax(depth - 1, -Infinity, exactRoot ? Infinity : -alpha, 1);
        pos.unmake();
        scores.push([m, score]);
        if (score > alpha) {
          alpha = score;
          bestMove = m;
        }
      }
      best = { move: bestMove, scores, depth };
      if (alpha > MATE - 1000) break;
    } catch (err) {
      if (err !== TIMEOUT) throw err;
      break; // the partial iteration is unreliable: keep the last complete one
    }
  }
  return best;
}

export default {
  worker: true,
  budgetMs: { easy: LEVELS.easy.timeMs, normal: LEVELS.normal.timeMs, hard: LEVELS.hard.timeMs },
  pick(state, seat, level, rng) {
    const cfg = LEVELS[level] ?? LEVELS.normal;
    const res = searchChess(state.fen, { ...cfg, exactRoot: cfg.noise > 0 });
    if (!res.move) return null;
    let move = res.move;
    if (cfg.noise && res.scores.length > 1) {
      // Pick the best move after adding random noise to every score.
      let bestScore = -Infinity;
      for (const [m, s] of res.scores) {
        const noisy = s + (rng() - 0.5) * 2 * cfg.noise;
        if (noisy > bestScore) {
          bestScore = noisy;
          move = m;
        }
      }
    }
    return toWire(move);
  },
};

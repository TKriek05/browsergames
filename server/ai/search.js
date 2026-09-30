// Generic minimax with alpha-beta pruning and iterative deepening on top of a
// rules module. Good for small/medium games (tic-tac-toe, connect four,
// reversi). Chess and draughts have their own faster engines.
//
// Scores are always from the ROOT seat's point of view, so games where the
// same side moves twice (a pass in reversi) need no special handling.

export const WIN = 1_000_000;
const TIMEOUT = Symbol('timeout');

// opts: { maxDepth, timeMs, evaluate(state, rootSeat), order?(moves, state, seat), minDepth? }
// The first minDepth plies are always searched to the end, however long it
// takes (tiny, and on a busy server a bot still sees a win or a threat).
const MIN_DEPTH = 2;
export function searchBestMove(rules, state, rootSeat, opts) {
  const { maxDepth, timeMs, evaluate, order, minDepth = MIN_DEPTH } = opts;
  const deadline = performance.now() + timeMs;
  let nodes = 0;
  let iteration = 0;
  let rootMoves = rules.legalMoves(state, rootSeat);
  if (!rootMoves.length) return null;
  if (rootMoves.length === 1) return { move: rootMoves[0], score: 0, depth: 0 };
  if (order) rootMoves = order(rootMoves, state, rootSeat);

  function minimax(s, depth, ply, alpha, beta) {
    if ((++nodes & 511) === 0 && iteration > minDepth && performance.now() > deadline) throw TIMEOUT;
    const res = rules.result(s);
    if (res) {
      if (res.draw || !res.winners.length) return 0;
      return res.winners.includes(rootSeat) ? WIN - ply : -WIN + ply;
    }
    if (depth === 0) return evaluate(s, rootSeat);
    const seat = rules.toMove(s)[0];
    let moves = rules.legalMoves(s, seat);
    if (order) moves = order(moves, s, seat);
    const maximizing = seat === rootSeat;
    let best = maximizing ? -Infinity : Infinity;
    for (const m of moves) {
      const score = minimax(rules.apply(s, seat, m).state, depth - 1, ply + 1, alpha, beta);
      if (maximizing) {
        if (score > best) best = score;
        if (best > alpha) alpha = best;
      } else {
        if (score < best) best = score;
        if (best < beta) beta = best;
      }
      if (alpha >= beta) break;
    }
    return best;
  }

  let result = { move: rootMoves[0], score: 0, depth: 0, scores: null };
  for (let depth = 1; depth <= maxDepth; depth++) {
    iteration = depth;
    if (depth > minDepth && performance.now() > deadline) break;
    try {
      let bestScore = -Infinity;
      let bestMove = rootMoves[0];
      const scores = new Map();
      let alpha = -Infinity;
      for (const m of rootMoves) {
        const score = minimax(rules.apply(state, rootSeat, m).state, depth - 1, 1, alpha, Infinity);
        scores.set(m, score);
        if (score > bestScore) {
          bestScore = score;
          bestMove = m;
        }
        if (score > alpha) alpha = score;
      }
      result = { move: bestMove, score: bestScore, depth, scores };
      // Search the best move first next iteration (better pruning).
      rootMoves = [bestMove, ...rootMoves.filter((m) => m !== bestMove)];
      if (Math.abs(bestScore) > WIN - 1000) break; // forced win/loss found
    } catch (err) {
      if (err !== TIMEOUT) throw err;
      break;
    }
  }
  return result;
}

// Difficulty helper: with probability `blunder` play a random move,
// otherwise the best one.
export function pickWithLevel(best, legal, rng, blunder) {
  if (!best) return legal[Math.floor(rng() * legal.length)] ?? null;
  if (rng() < blunder) return legal[Math.floor(rng() * legal.length)];
  return best.move;
}

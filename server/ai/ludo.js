// Erger je niet! bot: scores every movable pawn with simple heuristics.
import rules, { target, abs, TRACK } from '../../shared/rules/ludo.js';

const RANDOM = { easy: 1, normal: 0.15, hard: 0 };

// How many opponent pawns stand 1-6 squares behind an absolute square?
function threats(state, seat, square) {
  let n = 0;
  state.pawns.forEach((pawns, s) => {
    if (s === seat) return;
    for (const pos of pawns) {
      if (pos < 0 || pos >= TRACK) continue;
      const dist = (square - abs(state.quad[s], pos) + TRACK) % TRACK;
      if (dist >= 1 && dist <= 6) n++;
    }
  });
  return n;
}

export default {
  worker: false,
  pick(state, seat, level, rng) {
    const legal = rules.legalMoves(state, seat);
    if (!legal.length || legal[0].type === 'roll' || legal.length === 1) return legal[0] ?? null;
    if (rng() < (RANDOM[level] ?? 0.15)) return legal[Math.floor(rng() * legal.length)];
    let best = legal[0];
    let bestScore = -Infinity;
    for (const move of legal) {
      const from = state.pawns[seat][move.pawn];
      const to = target(state, seat, move.pawn, state.die);
      let score = to / 4;
      if (from === -1) score += 45;
      if (to >= TRACK) score += from < TRACK ? 60 : 20;
      if (to < TRACK) {
        const square = abs(state.quad[seat], to);
        const victim = state.pawns.some((pawns, s) => s !== seat && pawns.some((p) => p >= 0 && p < TRACK && abs(state.quad[s], p) === square));
        if (victim) score += 70;
        score -= threats(state, seat, square) * 14;
      }
      if (from >= 0 && from < TRACK) score += threats(state, seat, abs(state.quad[seat], from)) * 10;
      score += rng() * 2; // break ties
      if (score > bestScore) {
        bestScore = score;
        best = move;
      }
    }
    return best;
  },
};

// Tic-tac-toe bot: perfect play on "hard", deliberate mistakes below that.
import rules from '../../shared/rules/tictactoe.js';
import { searchBestMove, pickWithLevel } from './search.js';

const BLUNDER = { easy: 0.55, normal: 0.2, hard: 0 };

export default {
  worker: false,
  pick(state, seat, level, rng) {
    const legal = rules.legalMoves(state, seat);
    // Small tree: search it completely. Prefer the centre when all is equal.
    const best = searchBestMove(rules, state, seat, {
      maxDepth: 9,
      timeMs: 200,
      evaluate: () => 0,
      order: (moves) => [...moves].sort((a, b) => (b.c === 4) - (a.c === 4)),
    });
    return pickWithLevel(best, legal, rng, BLUNDER[level] ?? 0.2);
  },
};

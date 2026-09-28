// Bot engines per game. pick(state, seat, level, rng) → move.
// `worker: true` engines run in a worker thread (see pool.js).
import tictactoe from './tictactoe.js';

export const ENGINES = {
  tictactoe,
};

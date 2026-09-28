// Bot engines per game. pick(state, seat, level, rng) → move.
// `worker: true` engines run in a worker thread (see pool.js).
import tictactoe from './tictactoe.js';
import connect4 from './connect4.js';
import reversi from './reversi.js';
import checkers from './checkers.js';
import chess from './chess.js';

export const ENGINES = {
  tictactoe,
  connect4,
  reversi,
  checkers,
  chess,
};

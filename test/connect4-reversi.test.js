// Connect four + reversi rules, and their bots (through the worker pool).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import connect4 from '../shared/rules/connect4.js';
import reversi, { movesFor } from '../shared/rules/reversi.js';
import { chooseMove, shutdownAi } from '../server/ai/index.js';

after(() => shutdownAi());

const play = (rules, moves) => {
  let s = rules.setup({ seats: 2 });
  for (const m of moves) s = rules.apply(s, rules.toMove(s)[0], m).state;
  return s;
};

test('connect4: vertical, horizontal and diagonal wins', () => {
  const v = play(connect4, [0, 1, 0, 1, 0, 1, 0].map((col) => ({ col })));
  assert.deepEqual(connect4.result(v).winners, [0]);
  const hz = play(connect4, [0, 0, 1, 1, 2, 2, 3].map((col) => ({ col })));
  assert.deepEqual(connect4.result(hz).winners, [0]);
  assert.equal(hz.line.length, 4);
  // Diagonal "/" for seat 0: (5,0) (4,1) (3,2) (2,3)
  const d = play(connect4, [0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3].map((col) => ({ col })));
  assert.deepEqual(connect4.result(d).winners, [0]);
});

test('connect4: full columns are not playable, full board is a draw', () => {
  const s = play(connect4, [0, 0, 0, 0, 0, 0].map((col) => ({ col })));
  assert.ok(!connect4.legalMoves(s, 0).some((m) => m.col === 0));
  // Row pattern AABBAAB, flipped on every other row: no four in any direction.
  const pattern = [0, 0, 1, 1, 0, 0, 1];
  const board = [];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) board.push(pattern[c] ^ (r % 2));
  board[6] = -1; // top of the last column still empty; it belongs to seat 1
  const almost = { board, heights: [6, 6, 6, 6, 6, 6, 5], turn: 1, line: null, over: null };
  const r = connect4.result(connect4.apply(almost, 1, { col: 6 }).state);
  assert.equal(r.draw, true);
});

test('reversi: standard opening moves and flips', () => {
  const s = reversi.setup({ seats: 2 });
  assert.deepEqual(reversi.legalMoves(s, 0).map((m) => m.sq), [20, 29, 34, 43]);
  const { state, info } = reversi.apply(s, 0, { sq: 20 });
  assert.deepEqual(info.flips, [28]);
  assert.deepEqual(reversi.view(state).count, [4, 1]);
  assert.deepEqual(reversi.toMove(state), [1]);
});

test('reversi: a player without moves passes; no moves for anyone ends the game', () => {
  // White can only go at 2; after that black has no moves → pass, …
  const board = new Array(64).fill(-1);
  board[0] = 0; board[1] = 1;
  let s = { board, turn: 1, over: null };
  assert.deepEqual(movesFor(board, 1), []);
  assert.deepEqual(movesFor(board, 0), [2]);
  s = { ...s, turn: 0 };
  const r = reversi.apply(s, 0, { sq: 2 });
  assert.ok(reversi.result(r.state), 'nobody can move: game over');
  assert.deepEqual(reversi.result(r.state).winners, [0]);
});

test('bots answer through the worker pool with legal moves', async () => {
  const c = play(connect4, [3, 3, 4, 4].map((col) => ({ col })));
  // Seat 0 can win immediately with column 2 or 5.
  const move = await chooseMove('connect4', c, 0, 'hard');
  assert.ok(move.col === 2 || move.col === 5, `winning move expected, got ${move.col}`);
  // Seat 1 to move must block when seat 0 threatens three in a row.
  const threat = play(connect4, [0, 6, 1, 6, 2].map((col) => ({ col })));
  const block = await chooseMove('connect4', threat, 1, 'normal');
  assert.equal(block.col, 3);
  const r = reversi.setup({ seats: 2 });
  const rm = await chooseMove('reversi', r, 0, 'hard');
  assert.ok([20, 29, 34, 43].includes(rm.sq));
});

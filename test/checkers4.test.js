// Dammen voor 4: the cross board, the start position, men per arm, forced
// maximum captures of any opponent, flying kings, promotion on the far edge,
// players dropping out and complete bot games for 2, 3 and 4 players.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import rules, {
  SIZE, SQUARES, EMPTY, idx, onBoard, armsFor, initialBoard, generateMoves, playMove, manOf, kingOf, pieceArm, promotes,
} from '../shared/rules/checkers4.js';
import bot from '../server/ai/checkers4.js';
import { createRng } from '../shared/rng.js';

const empty = () => new Array(SIZE * SIZE).fill(EMPTY);

test('the cross: 14 × 14 without the corners, dark squares only', () => {
  assert.equal(onBoard(0, 0), false);
  assert.equal(onBoard(2, 2), false);
  assert.equal(onBoard(0, 3), true);
  assert.equal(onBoard(0, 4), false, 'light square');
  assert.equal(SQUARES.length, (SIZE * SIZE - 4 * 9) / 2);
});

test('start: 12 men per arm in play, empty arms stay empty', () => {
  for (const n of [2, 3, 4]) {
    const arms = armsFor(n);
    const board = initialBoard(arms);
    for (let a = 0; a < 4; a++) {
      const count = board.filter((p) => pieceArm(p) === a).length;
      assert.equal(count, arms.includes(a) ? 12 : 0, `${n} players, arm ${a}`);
    }
  }
  const s = rules.setup({ seats: 4 });
  assert.deepEqual(rules.toMove(s), [0]);
  const moves = rules.legalMoves(s, 0);
  assert.ok(moves.length > 0 && moves.every((m) => !m.caps.length));
  assert.ok(moves.every((m) => m.path[1] < m.path[0]), 'bottom arm moves up');
  assert.ok(rules.legalMoves(s, 1).length === 0, 'not your turn');
});

test('men step forward for their own arm', () => {
  const dirs = { 0: [-1, 0], 1: [0, 1], 2: [1, 0], 3: [0, -1] };
  for (let a = 0; a < 4; a++) {
    const board = empty();
    board[idx(6, 7)] = manOf(a);
    const moves = generateMoves(board, a);
    assert.equal(moves.length, 2);
    for (const m of moves) {
      const [r0, c0] = [6, 7];
      const r1 = Math.floor(m.path[1] / SIZE);
      const c1 = m.path[1] % SIZE;
      const [dr, dc] = dirs[a];
      if (dr) assert.equal(r1 - r0, dr, `arm ${a} row`);
      if (dc) assert.equal(c1 - c0, dc, `arm ${a} col`);
    }
  }
});

test('capturing any opponent is forced, the longest sequence wins, men capture backwards', () => {
  const board = empty();
  board[idx(7, 6)] = manOf(0);
  board[idx(6, 5)] = manOf(1); // in front
  board[idx(8, 7)] = manOf(2); // behind: backwards capture
  board[idx(10, 7)] = manOf(3); // … and then another one
  board[idx(12, 7)] = EMPTY;
  const moves = generateMoves(board, 0);
  assert.ok(moves.length >= 1 && moves.every((m) => m.caps.length === 2), 'the double capture is forced');
  assert.deepEqual(moves[0].caps.sort((a, b) => a - b), [idx(8, 7), idx(10, 7)].sort((a, b) => a - b));
});

test('kings fly and capture from a distance; promotion only on the far edge', () => {
  const board = empty();
  board[idx(12, 3)] = kingOf(0);
  board[idx(7, 8)] = manOf(2);
  const moves = generateMoves(board, 0);
  assert.ok(moves.every((m) => m.caps.length === 1 && m.caps[0] === idx(7, 8)));
  assert.ok(moves.some((m) => m.path[1] === idx(5, 10)) && moves.some((m) => m.path[1] === idx(6, 9)), 'any landing square');
  assert.ok(promotes(0, idx(0, 5)) && !promotes(0, idx(3, 0)) && promotes(1, idx(5, 13)));
  const b2 = empty();
  b2[idx(1, 4)] = manOf(0);
  const { board: after, promoted } = playMove(b2, { path: [idx(1, 4), idx(0, 5)], caps: [] });
  assert.ok(promoted && after[idx(0, 5)] === kingOf(0));
});

test('who can not move is out; the last one standing wins with a ranking', () => {
  const s = rules.setup({ seats: 3 });
  const board = empty();
  board[idx(12, 5)] = manOf(0);
  board[idx(6, 1)] = manOf(1);
  board[idx(5, 2)] = manOf(0); // blocks? no: arm 1 captures it
  const state = { ...s, board, turn: 0, out: [2] };
  const moves = rules.legalMoves(state, 0);
  const res = rules.apply(state, 0, moves[0]);
  assert.ok(res.state.turn === 1 || res.state.over);
  // Take away everything from arm 1: after seat 0 moves, seat 1 is out and 0 wins.
  const b3 = empty();
  b3[idx(12, 5)] = manOf(0);
  const st = { ...s, board: b3, turn: 0, out: [2] };
  const r = rules.apply(st, 0, rules.legalMoves(st, 0)[0]);
  assert.deepEqual(r.state.over.winners, [0]);
  assert.deepEqual(r.state.over.ranking, [0, 1, 2]);
  assert.deepEqual(r.info.out, [1]);
});

test('bots finish games for 2, 3 and 4 players (never an illegal move)', () => {
  for (const seats of [2, 3, 4]) {
    const rng = createRng(seats);
    let state = rules.setup({ seats });
    let plies = 0;
    while (!rules.result(state) && plies < 1500) {
      const seat = rules.toMove(state)[0];
      const level = ['easy', 'normal', 'hard', 'normal'][seat];
      const move = bot.pick(rules.view(state), seat, level === 'hard' ? 'normal' : level, rng);
      const legal = rules.legalMoves(state, seat);
      assert.ok(legal.some((m) => JSON.stringify(m) === JSON.stringify(move)), 'legal');
      state = rules.apply(state, seat, move).state;
      plies++;
    }
    const res = rules.result(state);
    assert.ok(res, `${seats} players: the game ends (${plies} plies)`);
    assert.equal(res.ranking.length, seats);
  }
});

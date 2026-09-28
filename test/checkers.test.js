// Dammen: known positions for the tricky Dutch/FMJD rules.
// Squares are written 1-50 like in Dutch notation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import rules, { WM, WK, BM, BK, EMPTY } from '../shared/rules/checkers.js';

function position({ w = [], wk = [], b = [], bk = [], turn = 0 }) {
  const board = new Array(50).fill(EMPTY);
  for (const s of w) board[s - 1] = WM;
  for (const s of wk) board[s - 1] = WK;
  for (const s of b) board[s - 1] = BM;
  for (const s of bk) board[s - 1] = BK;
  return { board, turn, kingPlies: 0, seen: {}, over: null };
}
const notation = (m) => m.path.map((s) => s + 1).join(m.caps.length ? 'x' : '-');
const legal = (state) => rules.legalMoves(state, state.turn).map(notation).sort();

test('opening position has the 9 standard moves', () => {
  assert.deepEqual(legal(rules.setup()), ['31-26', '31-27', '32-27', '32-28', '33-28', '33-29', '34-29', '34-30', '35-30']);
});

test('capturing is mandatory and the maximum capture must be taken', () => {
  // 33x22x11 takes two pieces (28 and 17); 33x24 takes only one (29).
  const s = position({ w: [33, 45], b: [28, 29, 17] });
  assert.deepEqual(legal(s), ['33x22x11']);
});

test('men capture backwards too', () => {
  const s = position({ w: [28], b: [33, 5] });
  assert.deepEqual(legal(s), ['28x39']);
});

test('a flying king captures from a distance and may land on any free square behind', () => {
  const s = position({ wk: [46], b: [28] });
  assert.deepEqual(legal(s), ['46x10', '46x14', '46x19', '46x23', '46x5']);
});

test('a king that must continue capturing picks the landing square that allows it', () => {
  // After taking 28, only landing on 19 lets the king also take 24; behind 24
  // it may stop on 30 or 35.
  const s = position({ wk: [46], b: [28, 24] });
  assert.deepEqual(legal(s), ['46x19x30', '46x19x35']);
  for (const m of rules.legalMoves(s, 0)) assert.equal(m.caps.length, 2);
});

test('a man that passes the back row during a capture does not promote', () => {
  // 13x2x11: touches square 2 (back row) but ends on 11.
  const s = position({ w: [13], b: [8, 7] });
  assert.deepEqual(legal(s), ['13x2x11']);
  const { state, info } = rules.apply(s, 0, rules.legalMoves(s, 0)[0]);
  assert.equal(info.promoted, false);
  assert.equal(state.board[10], WM);
  // Ending on the back row does promote.
  const p = position({ w: [7], b: [40] });
  const r = rules.apply(p, 0, rules.legalMoves(p, 0).find((m) => m.path[1] === 1));
  assert.equal(r.info.promoted, true);
  assert.equal(r.state.board[1], WK);
});

test('captured pieces are removed only after the sequence and cannot be jumped twice', () => {
  // A white king on 1 with black pieces around: whatever the route, each
  // captured square appears once and the maximum is found.
  const s = position({ wk: [1], b: [7, 18, 29, 40, 38, 27, 16] });
  const moves = rules.legalMoves(s, 0);
  assert.ok(moves.length > 0);
  for (const m of moves) assert.equal(new Set(m.caps).size, m.caps.length);
  const { state } = rules.apply(s, 0, moves[0]);
  for (const c of moves[0].caps) assert.equal(state.board[c], EMPTY);
});

test('no legal moves means you lose; losing all pieces too', () => {
  const s = position({ w: [28], b: [22] }); // white takes the last black piece
  const { state } = rules.apply(s, 0, rules.legalMoves(s, 0)[0]);
  assert.deepEqual(rules.result(state).winners, [0]);
  // Black's only man (36) is blocked by 41/47: after any white move black cannot move.
  const blocked = position({ w: [41, 47, 50], b: [36] });
  const r = rules.apply(blocked, 0, rules.legalMoves(blocked, 0).find((m) => m.path[0] === 49));
  assert.deepEqual(rules.result(r.state).winners, [0]);
  assert.match(rules.result(r.state).reason, /niet meer zetten/);
});

test('threefold repetition with kings is a draw', () => {
  // Kings on 50 and 1, off each other's diagonals: shuffle 50-45 / 1-6 and back.
  let s = { ...position({ wk: [50], bk: [1] }), kingPlies: 1 };
  const shuffle = [[0, 49, 44], [1, 0, 5], [0, 44, 49], [1, 5, 0]];
  for (let i = 0; i < 12 && !rules.result(s); i++) {
    const [seat, from, to] = shuffle[i % 4];
    const move = rules.legalMoves(s, seat).find((m) => m.path[0] === from && m.path[1] === to);
    s = rules.apply(s, seat, move).state;
  }
  assert.equal(rules.result(s)?.draw, true);
  assert.match(rules.result(s).reason, /Drie keer/);
});

test('25 moves each with only kings is a draw', () => {
  let s = { ...position({ wk: [50, 49], bk: [1, 2] }), kingPlies: 49 };
  const move = rules.legalMoves(s, 0).find((m) => m.path[0] === 49 && m.path[1] === 44);
  s = rules.apply(s, 0, move).state;
  assert.equal(rules.result(s)?.draw, true);
  assert.match(rules.result(s).reason, /25 zetten/);
});

test('the bot takes the maximum capture and finds a winning shot', async () => {
  const { default: bot } = await import('../server/ai/checkers.js');
  const s = position({ w: [33, 45], b: [28, 29, 17] });
  const m = bot.pick(s, 0, 'hard', Math.random);
  assert.equal(notation(m), '33x22x11');
  // Quiet position: the bot must return one of the legal moves in time.
  const start = rules.setup();
  const t0 = performance.now();
  const q = bot.pick(start, 0, 'normal', () => 0.5);
  assert.ok(legal(start).includes(notation(q)));
  assert.ok(performance.now() - t0 < 2000);
});

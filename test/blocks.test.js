// Blokval: rules (pieces, rotation, line clears, garbage) and the server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import blocks from '../server/games/blocks.js';
import {
  COLS, ROWS, SHAPES, createSequence, emptyBoard, spawn, fits, dropY, tryRotate, place, addGarbage, encodeBoard, decodeBoard,
} from '../shared/games/blocks.js';
import { ARCADE_PHASE } from '../shared/games/arcade.js';

function fakeRoom(players) {
  const room = { clock: 0, events: [], results: null, gamePlayers: () => players, now: () => room.clock,
    emit: (e, d) => room.events.push({ e, ...d }), endGame(r) { room.results = r; } };
  return room;
}
const bot = (id, slot, level = 'normal') => ({ id, slot, name: `Bot${slot}`, color: slot, isBot: true, botLevel: level });
const human = (id, slot) => ({ id, slot, name: `Mens${slot}`, color: slot, isBot: false, connected: true });
function run(game, room, seconds) {
  for (let i = 0; i < seconds * 10 && !room.results; i++) game.tick(0.1);
}

test('every piece has four cells in all rotations; the sequence uses 7-bags', () => {
  for (const states of SHAPES) for (const cells of states) assert.equal(cells.length, 4);
  const next = createSequence(42);
  const bag = new Set(Array.from({ length: 7 }, (_, i) => next(i)));
  assert.equal(bag.size, 7, 'each bag holds every piece once');
  assert.equal(createSequence(42)(20), next(20), 'same seed, same order');
});

test('dropping, rotating with kicks, clearing lines and garbage', () => {
  let b = emptyBoard();
  const I = 0;
  // Fill the bottom row except the last 4 cells, then drop a flat I there.
  for (let c = 0; c < 6; c++) b[(ROWS - 1) * COLS + c] = 8;
  const y = dropY(b, I, 0, 6, 0);
  const res = place(b, I, 0, 6, y);
  assert.equal(res.lines, 1);
  assert.ok(res.board.every((v) => v === 0), 'board empty again');
  // Rotation at the wall kicks the piece back in.
  const r = tryRotate(emptyBoard(), I, 1, -2, 5, 1);
  assert.ok(r && fits(emptyBoard(), I, r.r, r.x, r.y));
  // Garbage pushes up and reports overflow at the top.
  b = emptyBoard();
  b[0] = 1;
  const g = addGarbage(b, 2, 4);
  assert.equal(g.overflow, true);
  const clean = addGarbage(emptyBoard(), 3, 7);
  assert.equal(clean.board[(ROWS - 1) * COLS + 7], 0, 'the hole');
  assert.equal(clean.board[(ROWS - 1) * COLS + 6], 8);
  assert.deepEqual(decodeBoard(encodeBoard(clean.board)), clean.board);
});

test('the server accepts valid locks, rejects cheats and sends garbage', () => {
  const a = human('p1', 0);
  const b = human('p2', 1);
  const room = fakeRoom([a, b]);
  const game = blocks.create(room, { seed: 3 });
  run(game, room, 3.1);
  assert.equal(game.phase, ARCADE_PHASE.PLAY);
  const ba = game.boards[0];
  const next = createSequence(game.seed);
  // A floating piece is refused (resync), a dropped one accepted.
  const k = next(0);
  const s = spawn(k);
  game.onInput(a, { t: 'lock', i: 0, r: 0, x: s.x, y: 3 });
  assert.equal(ba.idx, 0);
  assert.equal(ba.resync, 1);
  ba.lastLock = 0;
  game.onInput(a, { t: 'lock', i: 0, r: 0, x: s.x, y: dropY(ba.board, k, 0, s.x, 0) });
  assert.equal(ba.idx, 1);
  // Garbage goes to the (only) opponent and waits in their queue.
  game._send(ba, 1);
  assert.equal(game.boards[1].pending.length, 1);
  assert.ok(room.events.some((e) => e.e === 'attack' && e.to === 1));
});

test('bot battles end with one winner; hard bots usually win', () => {
  let hardWins = 0;
  for (let seed = 1; seed <= 3; seed++) {
    const room = fakeRoom([bot('p1', 0, 'hard'), bot('p2', 1, 'normal')]);
    const game = blocks.create(room, { seed });
    run(game, room, 900);
    assert.ok(room.results, 'ended');
    assert.equal(room.results.rows.length, 2);
    assert.ok(room.events.some((e) => e.e === 'ko'));
    if (room.results.rows[0].name === 'Bot0') hardWins++;
  }
  assert.ok(hardWins >= 2, `hard bot won ${hardWins}/3`);
});

test('the snapshot shows every board', () => {
  const room = fakeRoom([bot('p1', 0), human('p2', 1)]);
  const game = blocks.create(room, { seed: 1 });
  const snap = game.snapshot({ slot: 1 });
  assert.equal(snap.players.length, 2);
  assert.equal(snap.players[0].board.length, COLS * ROWS);
  assert.equal(snap.you, 1);
});

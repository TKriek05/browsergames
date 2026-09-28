// Erger je niet!, Ganzenbord and Zeeslag: rule scenarios with a seeded RNG.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ludo, { movablePawns, TRACK } from '../shared/rules/ludo.js';
import goose from '../shared/rules/goose.js';
import battleship, { validPlacement, randomPlacement, FLEET } from '../shared/rules/battleship.js';
import ludoBot from '../server/ai/ludo.js';
import shipBot from '../server/ai/battleship.js';
import { createRng } from '../shared/rng.js';
import { makeGame, runTicks, bot } from './board-helpers.js';

// An rng that returns fixed dice: die value d → (d - 0.5) / 6.
const dice = (...values) => { let i = 0; return () => (values[i++ % values.length] - 0.5) / 6; };

// --- Erger je niet! ------------------------------------------------------------------
const ludoState = (pawns, extra = {}) => ({ ...ludo.setup({ seats: pawns.length }), pawns, ...extra });

test('ludo: you need a 6 to come out, with three tries when nothing is on the board', () => {
  let s = ludo.setup({ seats: 2 });
  const rng = dice(3, 4, 2, 6);
  for (let i = 0; i < 2; i++) {
    s = ludo.apply(s, 0, { type: 'roll' }, rng).state;
    assert.equal(s.turn, 0, `try ${i + 2} for the same player`);
  }
  s = ludo.apply(s, 0, { type: 'roll' }, rng).state;
  assert.equal(s.turn, 1, 'after three failures the turn passes');
  s = ludo.apply(s, 1, { type: 'roll' }, rng).state; // a 6
  assert.equal(s.phase, 'move');
  assert.deepEqual(ludo.legalMoves(s, 1), [{ type: 'move', pawn: 0 }]);
  const r = ludo.apply(s, 1, { type: 'move', pawn: 0 });
  assert.equal(r.state.pawns[1][0], 0, 'on the start square');
  assert.equal(r.state.turn, 1, 'a 6 means roll again');
});

test('ludo: with a 6 bringing a pawn out is compulsory; the start square must be cleared', () => {
  const s = ludoState([[5, -1, -1, -1], [-1, -1, -1, -1]], { phase: 'move', die: 6 });
  assert.deepEqual(movablePawns(s, 0, 6), [1]);
  const onStart = ludoState([[0, -1, -1, -1], [-1, -1, -1, -1]], { phase: 'move', die: 3 });
  assert.deepEqual(movablePawns(onStart, 0, 3), [0]);
});

test('ludo: capturing sends the other pawn home; you cannot land on your own pawn', () => {
  // Seat 0 (quadrant 0) at 8; seat 1 (quadrant 2) at relative 32 = absolute 12.
  const s = ludoState([[8, 10, -1, -1], [32, -1, -1, -1]], { phase: 'move', die: 4 });
  const r = ludo.apply(s, 0, { type: 'move', pawn: 0 });
  assert.equal(r.state.pawns[1][0], -1);
  assert.deepEqual(r.info.captured, { seat: 1, pawn: 0 });
  const blocked = ludoState([[8, 10, -1, -1], [-1, -1, -1, -1]], { phase: 'move', die: 2 });
  assert.deepEqual(movablePawns(blocked, 0, 2), [1]);
});

test('ludo: the home lane needs an exact roll and no jumping over your own pawns', () => {
  const s = ludoState([[38, 42, 43, 41], [-1, -1, -1, -1]], { phase: 'move', die: 3 });
  assert.deepEqual(movablePawns(s, 0, 3), [], '38+3 = 41 is taken, 38+6 overshoots');
  const t = ludoState([[39, 41, 43, 42], [-1, -1, -1, -1]], { phase: 'move', die: 1 });
  assert.deepEqual(movablePawns(t, 0, 1), [0], '39+1 = 40 is free');
  const jump = ludoState([[38, 41, 43, 42], [-1, -1, -1, -1]], { phase: 'move', die: 2 });
  assert.deepEqual(movablePawns(jump, 0, 2), [0]);
  const over = ludoState([[39, 40, 43, 42], [-1, -1, -1, -1]], { phase: 'move', die: 2 });
  assert.deepEqual(movablePawns(over, 0, 2), [], 'would jump over the pawn on 40');
});

test('ludo: all four pawns home wins, others ranked by progress', () => {
  const s = ludoState([[39, 41, 42, 43], [10, 5, -1, -1], [30, -1, -1, -1]], { phase: 'move', die: 1 });
  const r = ludo.apply(s, 0, { type: 'move', pawn: 0 });
  assert.deepEqual(r.state.over.winners, [0]);
  assert.deepEqual(r.state.over.ranking, [0, 2, 1]);
});

test('ludo: bots finish a 4-player game', async () => {
  const { game } = makeGame(ludo, [bot('p1', 0), bot('p2', 1, 'easy'), bot('p3', 2, 'normal'), bot('p4', 3)]);
  assert.ok(await runTicks(game, () => !!game.over, 4000));
  assert.equal(game.over.ranking.length, 4);
  assert.ok(game.state.pawns[game.over.winners[0]].every((p) => p >= TRACK));
});

// --- Ganzenbord ---------------------------------------------------------------------------
const goosePlay = (pos, d1, d2, extra = {}) => {
  const s = { ...goose.setup({ seats: 2 }), first: [false, false], ...extra };
  s.pos = [pos, 0];
  return goose.apply(s, 0, { type: 'roll' }, dice(d1, d2));
};

test('goose: geese move you again, the bridge, the maze and death', () => {
  assert.equal(goosePlay(0, 2, 3).state.pos[0], 10, '5 is a goose: 5 + 5');
  assert.equal(goosePlay(1, 2, 3).state.pos[0], 12, '6 is the bridge');
  assert.equal(goosePlay(40, 1, 1).state.pos[0], 39, '42 is the maze');
  assert.equal(goosePlay(55, 1, 2).state.pos[0], 0, '58 is death');
});

test('goose: first throw 6+3 → 26, 5+4 → 53', () => {
  const s = goose.setup({ seats: 2 });
  assert.equal(goose.apply(s, 0, { type: 'roll' }, dice(6, 3)).state.pos[0], 26);
  assert.equal(goose.apply(s, 0, { type: 'roll' }, dice(4, 5)).state.pos[0], 53);
});

test('goose: exact finish, bouncing back; herberg skips a turn; the well traps', () => {
  assert.equal(goosePlay(60, 2, 3).state.pos[0], 61, '60 + 5 = 65 → back to 61');
  const win = goosePlay(60, 1, 2);
  assert.deepEqual(win.state.over.winners, [0]);
  const inn = goosePlay(15, 2, 2).state; // 19
  assert.equal(inn.skip[0], 1);
  // Player 1 rolls, then player 0 sits out and player 1 goes again.
  const after = goose.apply(inn, 1, { type: 'roll' }, dice(1, 2));
  assert.equal(after.state.turn, 1);
  assert.deepEqual(after.info.skipped, [0]);
  // Well: stuck until the other player arrives.
  const well = { ...goose.setup({ seats: 2 }), first: [false, false], pos: [28, 31], stuck: [false, true] };
  const freed = goose.apply(well, 0, { type: 'roll' }, dice(1, 2)).state;
  assert.equal(freed.stuck[1], false);
  assert.equal(freed.stuck[0], true);
});

test('goose: a 6-player bot game ends', async () => {
  const players = Array.from({ length: 6 }, (_, i) => bot(`p${i + 1}`, i));
  const { game } = makeGame(goose, players);
  assert.ok(await runTicks(game, () => !!game.over, 4000));
  assert.equal(game.state.pos[game.over.winners[0]], 63);
});

// --- Zeeslag --------------------------------------------------------------------------------
test('battleship: placement validation (bounds, overlap, touching)', () => {
  const good = [{ x: 0, y: 0, dir: 'h' }, { x: 0, y: 2, dir: 'h' }, { x: 0, y: 4, dir: 'h' }, { x: 0, y: 6, dir: 'h' }, { x: 0, y: 8, dir: 'h' }];
  assert.ok(validPlacement(good));
  assert.ok(!validPlacement([...good.slice(0, 4), { x: 9, y: 8, dir: 'h' }]), 'out of bounds');
  assert.ok(!validPlacement([...good.slice(0, 4), { x: 0, y: 7, dir: 'h' }]), 'touches');
  assert.ok(validPlacement([...good.slice(0, 4), { x: 0, y: 7, dir: 'h' }], true), 'touching allowed');
  assert.ok(!validPlacement([...good.slice(0, 4), { x: 0, y: 6, dir: 'h' }], true), 'overlap');
  const rng = createRng(7);
  for (let i = 0; i < 50; i++) assert.ok(validPlacement(randomPlacement(rng)));
});

test('battleship: hidden ships, hits, sinking and the extra shot', () => {
  const layout = [{ x: 0, y: 0, dir: 'h' }, { x: 0, y: 2, dir: 'h' }, { x: 0, y: 4, dir: 'h' }, { x: 0, y: 6, dir: 'h' }, { x: 0, y: 8, dir: 'h' }];
  let s = battleship.setup({ settings: {} });
  assert.deepEqual(battleship.toMove(s), [0, 1]);
  s = battleship.apply(s, 0, { type: 'place', ships: layout }).state;
  s = battleship.apply(s, 1, { type: 'place', ships: layout }).state;
  assert.equal(s.phase, 'fire');
  assert.equal(battleship.view(s, 0).boards[1].ships, null, 'opponent ships are hidden');
  assert.ok(battleship.view(s, 0).boards[0].ships, 'own ships are visible');
  let r = battleship.apply(s, 0, { type: 'fire', c: 80 }); // destroyer at y=8, x=0..1
  assert.equal(r.info.hit, true);
  assert.equal(r.state.turn, 0, 'hit: shoot again');
  r = battleship.apply(r.state, 0, { type: 'fire', c: 81 });
  assert.equal(r.info.sunk.name, 'Torpedobootjager');
  assert.equal(r.state.shots[1][70], 3, 'water around a sunk ship is revealed');
  r = battleship.apply(r.state, 0, { type: 'fire', c: 99 });
  assert.equal(r.info.hit, false);
  assert.equal(r.state.turn, 1);
  assert.ok(!battleship.isLegal(r.state, 1, { type: 'fire', c: 200 }));
  assert.equal(FLEET.length, 5);
});

test('battleship: bots never see hidden ships and finish the game', async () => {
  const { game } = makeGame(battleship, [bot('p1', 0, 'hard'), bot('p2', 1, 'normal')], { touching: false, extraShot: true });
  assert.ok(await runTicks(game, () => !!game.over, 4000));
  // The hard bot's first shot on an empty board uses the probability map (centre-ish), not the ship list.
  const s = battleship.setup({ settings: {} });
  const placed = battleship.apply(battleship.apply(s, 0, { type: 'random' }, createRng(1)).state, 1, { type: 'random' }, createRng(2)).state;
  const shot = shipBot.pick(placed, 0, 'hard', createRng(3));
  const x = shot.c % 10;
  const y = Math.floor(shot.c / 10);
  assert.ok(x >= 2 && x <= 7 && y >= 2 && y <= 7, `first hard shot near the centre, got ${x},${y}`);
  assert.equal(ludoBot.pick(ludo.setup({ seats: 2 }), 0, 'hard', Math.random).type, 'roll');
});

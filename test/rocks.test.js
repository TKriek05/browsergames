// Rotsregen: ship physics, splitting rocks, versus hits, bots, snapshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import rocks from '../server/games/rocks.js';
import { stepShip, createShip, ROCKS_FIELD as F } from '../shared/physics/rocks.js';
import { ARCADE_PHASE } from '../shared/games/arcade.js';
import { BTN } from '../shared/messages.js';
import { ByteWriter, ByteReader, quantizeAxis } from '../shared/binary.js';
import { createRng } from '../shared/rng.js';
import { SIM_TICK_RATE } from '../shared/constants.js';

const DT = 1 / SIM_TICK_RATE;
function fakeRoom(players) {
  const room = { clock: 0, events: [], results: null, gamePlayers: () => players, now: () => room.clock,
    emit: (e, d) => room.events.push({ e, ...d }), endGame(r) { room.results = r; } };
  return room;
}
const bot = (id, slot, level = 'normal') => ({ id, slot, name: `Bot${slot}`, color: slot, isBot: true, botLevel: level });
const human = (id, slot) => ({ id, slot, name: `Mens${slot}`, color: slot, isBot: false, connected: true });
function run(game, room, seconds) {
  for (let i = 0; i < seconds * SIM_TICK_RATE && !room.results; i++) { room.clock += DT * 1000; game.tick(DT); }
}

test('ship physics: deterministic, float32, wraps around the edges', () => {
  const rng = createRng(3);
  const inputs = Array.from({ length: 600 }, () => [quantizeAxis(rng() * 2 - 1), rng() < 0.5]);
  const once = () => {
    const s = createShip();
    for (const [ax, th] of inputs) stepShip(s, ax, th, DT);
    return s;
  };
  assert.deepEqual(once(), once());
  const s = createShip(F.width - 1, 50);
  s.hx = 1; s.hy = 0;
  for (let i = 0; i < 10; i++) stepShip(s, 0, true, DT);
  assert.ok(s.x < 20, `wrapped to the left side (${s.x})`);
  for (const k of ['x', 'y', 'vx', 'vy', 'hx', 'hy']) assert.equal(s[k], Math.fround(s[k]));
});

test('a big rock splits into two medium ones; versus bullets hit ships', () => {
  const a = human('p1', 0);
  const b = human('p2', 1);
  const room = fakeRoom([a, b]);
  const game = rocks.create(room, { mode: 'versus', lives: 3, seed: 1 });
  run(game, room, 3.05);
  assert.equal(game.phase, ARCADE_PHASE.PLAY);
  const [ea, eb] = game.ents;
  game.rocks = [{ id: 1, x: 200, y: 90, vx: 0, vy: 0, size: 0, seed: 1 }];
  Object.assign(ea.s, { x: 150, y: 90, vx: 0, vy: 0, hx: 1, hy: 0 });
  Object.assign(eb.s, { x: 60, y: 150, vx: 0, vy: 0, hx: 1, hy: 0 });
  ea.safe = eb.safe = 0;
  game.onInput(a, { seq: 1, buttons: BTN.A, ax: 0, ay: 0, aim: 0 });
  run(game, room, 0.5);
  assert.equal(game.rocks.length, 2, 'split');
  assert.ok(game.rocks.every((r) => r.size === 1));
  assert.equal(ea.score, 20);

  game.rocks = [{ id: 5, x: 10, y: 10, vx: 0, vy: 0, size: 2, seed: 2 }];
  Object.assign(eb.s, { x: 200, y: 90 });
  ea.cooldown = 0;
  game.onInput(a, { seq: 2, buttons: BTN.A, ax: 0, ay: 0, aim: 0 });
  run(game, room, 0.5);
  assert.equal(eb.alive, false, 'shot down');
  assert.equal(eb.lives, 2);
  assert.ok(ea.score >= 20 + 250);
});

test('co-op bots clear waves until they run out of lives', () => {
  const room = fakeRoom([bot('p1', 0, 'hard'), bot('p2', 1, 'normal')]);
  const game = rocks.create(room, { mode: 'coop', lives: 1, seed: 4 });
  run(game, room, 400);
  assert.ok(room.results, 'ended');
  assert.ok(room.events.filter((e) => e.e === 'rock').length > 10, 'rocks were shot');
});

test('snapshot encoding has the documented layout', () => {
  const room = fakeRoom([bot('p1', 0), human('p2', 3)]);
  const game = rocks.create(room, { mode: 'coop', lives: 3, seed: 2 });
  run(game, room, 4);
  const w = new ByteWriter();
  game.snapshot(w);
  const r = new ByteReader(w.toBytes());
  assert.equal(r.u8(), ARCADE_PHASE.PLAY);
  r.f32(); r.u8(); r.u8();
  assert.equal(r.u8(), 2);
  r.pos += 2 * 32;
  const nr = r.u8();
  r.pos += nr * 8;
  const nb = r.u8();
  assert.equal(r.remaining, nb * 5);
});

// Pinguïnbotsen: deterministic sliding, dashes, bumps, the melting floe,
// falling off and complete bot matches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import penguins from '../server/games/penguins.js';
import { PG, createPenguin, stepPenguin, bump, floeRadius } from '../shared/games/penguins.js';
import { ARCADE_PHASE } from '../shared/games/arcade.js';
import { ByteWriter, ByteReader, quantizeAxis } from '../shared/binary.js';
import { createRng } from '../shared/rng.js';

const DT = PG.DT;
function fakeRoom(players) {
  const room = {
    clock: 0, events: [], results: null,
    gamePlayers: () => players,
    now: () => room.clock,
    emit: (e, data) => room.events.push({ e, ...data }),
    endGame(results) { room.results = results; },
  };
  return room;
}
const bot = (id, slot, level = 'normal') => ({ id, slot, name: `Bot${slot}`, color: slot, isBot: true, botLevel: level });
const human = (id, slot) => ({ id, slot, name: `Mens${slot}`, color: slot, isBot: false, connected: true });
const run = (game, room, seconds) => {
  for (let i = 0; i < seconds * 30 && !room.results; i++) {
    room.clock += DT * 1000;
    game.tick(DT);
  }
};

test('sliding is deterministic and float32-exact', () => {
  const rng = createRng(9);
  const inputs = Array.from({ length: 900 }, () => [quantizeAxis(rng() * 2 - 1), quantizeAxis(rng() * 2 - 1), rng() < 0.05 ? 1 : 0]);
  const once = () => {
    const s = createPenguin(10, -20);
    for (const [ax, ay, a] of inputs) stepPenguin(s, ax, ay, a, DT);
    return s;
  };
  const a = once();
  assert.deepEqual(a, once());
  for (const k of ['x', 'y', 'vx', 'vy', 'fx', 'fy', 'dash', 'cool']) assert.equal(a[k], Math.fround(a[k]), k);
});

test('ice: you keep sliding, a dash is edge-triggered and has a cooldown', () => {
  const s = createPenguin();
  for (let i = 0; i < 30; i++) stepPenguin(s, 1, 0, 0, DT);
  const v = s.vx;
  assert.ok(v > 60 && v <= PG.MAX_SPEED + 1e-3);
  for (let i = 0; i < 15; i++) stepPenguin(s, 0, 0, 0, DT);
  assert.ok(s.vx > v * 0.5, 'low friction: still sliding half a second later');
  stepPenguin(s, 1, 0, 1, DT);
  assert.ok(s.vx > PG.MAX_SPEED, 'dash');
  assert.ok(s.dash > 0 && s.cool > 0);
  const cool = s.cool;
  stepPenguin(s, 1, 0, 1, DT); // still held: no second dash
  assert.ok(s.cool < cool);
  stepPenguin(s, 1, 0, 0, DT);
  stepPenguin(s, 1, 0, 1, DT); // pressed again during the cooldown
  assert.ok(s.cool < cool);
});

test('bumps: a dashing penguin wins the push', () => {
  const a = createPenguin(0, 0);
  const b = createPenguin(PG.RADIUS * 2 - 1, 0);
  a.vx = 150;
  a.dash = PG.DASH_S;
  const impact = bump(a, b);
  assert.ok(impact > 0);
  assert.ok(b.vx > a.vx, 'the one that was hit flies off faster');
  assert.ok(Math.hypot(b.x - a.x, b.y - a.y) >= PG.RADIUS * 2 - 1e-3, 'pushed apart');
  assert.equal(bump(a, b), 0, 'moving apart: no second impulse');
});

test('the floe melts, then keeps melting in overtime', () => {
  assert.equal(floeRadius(0), PG.FLOE_START);
  assert.ok(floeRadius(PG.SHRINK_AFTER_S + PG.SHRINK_S / 2) < PG.FLOE_START);
  assert.equal(floeRadius(PG.SHRINK_AFTER_S + PG.SHRINK_S + 1), PG.FLOE_END);
  assert.equal(floeRadius(1000), PG.FLOE_MIN);
});

test('sliding off the floe drops you in the sea; the last one standing wins the round', () => {
  const a = human('p1', 0);
  const b = human('p2', 1);
  const room = fakeRoom([a, b]);
  const game = penguins.create(room, { wins: 2 });
  run(game, room, 3.1);
  assert.equal(game.phase, ARCADE_PHASE.PLAY);
  const eb = game.ent('p2');
  eb.s.x = PG.FLOE_START + 5;
  eb.s.y = 0;
  game.ent('p1').hit = null;
  run(game, room, 0.1);
  assert.equal(eb.alive, false);
  assert.ok(room.events.some((e) => e.e === 'splash' && e.s === 1));
  assert.ok(room.events.some((e) => e.e === 'roundEnd' && e.s === 0));
  assert.equal(game.ent('p1').wins, 1);
});

test('a push shortly before the fall counts for the pusher', () => {
  const room = fakeRoom([human('p1', 0), human('p2', 1)]);
  const game = penguins.create(room, {});
  run(game, room, 3.1);
  const ea = game.ent('p1');
  const eb = game.ent('p2');
  eb.hit = { by: ea, t: game.roundTime };
  eb.s.x = PG.FLOE_START + 5;
  run(game, room, 0.1);
  assert.equal(ea.pushes, 1);
  assert.equal(room.events.find((e) => e.e === 'splash').by, 0);
});

test('bots play full matches; every round ends', () => {
  for (const lineup of [['hard', 'easy'], ['easy', 'normal', 'hard', 'normal', 'easy', 'hard']]) {
    const players = lineup.map((l, i) => bot(`p${i}`, i, l));
    const room = fakeRoom(players);
    const game = penguins.create(room, { wins: 3, seed: 3 });
    run(game, room, 1200);
    assert.ok(room.results, `${lineup.length} bots: the match ends`);
    assert.ok(game.ents.some((e) => e.wins === 3));
    assert.equal(room.results.rows.length, lineup.length);
  }
});

test('snapshot has the documented layout', () => {
  const room = fakeRoom([human('p1', 0), bot('p2', 1)]);
  const game = penguins.create(room, {});
  run(game, room, 4);
  const w = new ByteWriter(64);
  game.snapshot(w);
  const r = new ByteReader(w.toBytes());
  assert.equal(r.u8(), ARCADE_PHASE.PLAY);
  r.f32();
  assert.equal(r.u8(), 1);
  assert.equal(r.f32(), PG.FLOE_START);
  assert.equal(r.u8(), 2);
  for (let i = 0; i < 2; i++) {
    r.u8(); r.u8(); r.u16();
    for (let k = 0; k < 8; k++) assert.ok(Number.isFinite(r.f32()));
    r.u8(); r.u8(); r.u8(); r.u8();
  }
  assert.equal(r.remaining, 0);
});

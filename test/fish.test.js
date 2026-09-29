// Hapvis: deterministic swimming, dashes, plankton, eating fish, points that
// never go down, power-ups (and none when they are off), and complete bot matches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fish from '../server/games/fish.js';
import { FISH, FISH_POWER, FISH_POWERS, FISH_POWER_RULES, createFish, stepFish, fishRadius, fishSpeed, planktonSpots, canEat } from '../shared/games/fish.js';
import { ARCADE_PHASE } from '../shared/games/arcade.js';
import { ByteWriter, ByteReader, quantizeAxis } from '../shared/binary.js';
import { createRng } from '../shared/rng.js';

const DT = FISH.DT;
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

test('swimming is deterministic, float32-exact and stays in the sea', () => {
  const rng = createRng(4);
  const inputs = Array.from({ length: 900 }, () => [quantizeAxis(rng() * 2 - 1), quantizeAxis(rng() * 2 - 1), rng() < 0.03 ? 1 : 0]);
  const once = () => {
    const s = createFish(50, 50, 60);
    for (const [ax, ay, a] of inputs) {
      stepFish(s, ax, ay, a, DT);
      const r = fishRadius(s.mass);
      assert.ok(s.x >= r - 1e-3 && s.x <= FISH.WIDTH - r + 1e-3 && s.y >= r - 1e-3 && s.y <= FISH.HEIGHT - r + 1e-3);
    }
    return s;
  };
  const a = once();
  assert.deepEqual(a, once());
  for (const k of ['x', 'y', 'vx', 'vy', 'mass', 'dash', 'cool', 'boost']) assert.equal(a[k], Math.fround(a[k]), k);
});

test('bigger fish are slower; a dash is faster but costs mass', () => {
  assert.ok(fishSpeed(10) > fishSpeed(200));
  assert.ok(fishRadius(200) > fishRadius(10));
  const s = createFish(600, 400, 50);
  for (let i = 0; i < 30; i++) stepFish(s, 1, 0, 0, DT);
  const cruise = s.vx;
  stepFish(s, 1, 0, 1, DT);
  for (let i = 0; i < 5; i++) stepFish(s, 1, 0, 1, DT);
  assert.ok(s.vx > cruise * 1.3, 'dash speed');
  assert.ok(s.mass < 50, 'costs mass');
  const small = createFish(600, 400, FISH.START_MASS);
  stepFish(small, 1, 0, 1, DT);
  assert.equal(small.dash, 0, 'the smallest fish cannot dash (nothing to spend)');
});

test('plankton spots are the same for the same seed', () => {
  const a = planktonSpots(123);
  const b = planktonSpots(123);
  assert.deepEqual([...a.xs], [...b.xs]);
  assert.ok(a.xs.every((x) => x > 0 && x < FISH.WIDTH));
});

test('eating: plankton and smaller fish; points stay when you get eaten', () => {
  const room = fakeRoom([human('p1', 0), human('p2', 1)]);
  const game = fish.create(room, { duration: 60 });
  run(game, room, 3.1);
  assert.equal(game.phase, ARCADE_PHASE.PLAY);
  const a = game.ent('p1');
  const b = game.ent('p2');
  // Plankton under fish a (the score starts from zero: the random seed may
  // have put some plankton in reach during the first ticks of play).
  game.food.fill(0);
  game.food[0] = 1;
  game.foodBack.fill(99);
  a.score = 0;
  a.s.x = game.spots.xs[0];
  a.s.y = game.spots.ys[0];
  run(game, room, 0.05);
  assert.equal(game.food[0], 0);
  assert.equal(a.score, 1);
  // A big fish eats a small one.
  a.s.mass = 100;
  b.s.x = a.s.x + 2;
  b.s.y = a.s.y;
  b.score = 40;
  run(game, room, 0.05);
  assert.equal(b.alive, false);
  assert.ok(a.s.mass > 100);
  assert.equal(a.eaten, 1);
  assert.equal(b.score, 40, 'points never go down');
  assert.ok(room.events.some((e) => e.e === 'gulp' && e.s === 0 && e.v === 1));
  run(game, room, FISH.RESPAWN_S + 0.2);
  assert.equal(b.alive, true, 'back as a small fish');
  assert.equal(b.s.mass, FISH.START_MASS);
  assert.ok(!canEat(b.s, a.s));
});

test('bot matches end; the snapshot has the documented layout', () => {
  const players = [bot('p1', 0, 'hard'), bot('p2', 1, 'easy'), bot('p3', 2, 'normal'), human('p4', 3)];
  const room = fakeRoom(players);
  const game = fish.create(room, { duration: 60, seed: 3 });
  run(game, room, 30);
  const w = new ByteWriter(64);
  game.snapshot(w);
  const r = new ByteReader(w.toBytes());
  assert.equal(r.u8(), ARCADE_PHASE.PLAY);
  r.f32();
  assert.equal(r.u32(), game.seed);
  assert.equal(r.u8(), 4);
  for (let i = 0; i < 4; i++) {
    r.u8(); r.u8(); r.u16();
    for (let k = 0; k < 10; k++) assert.ok(Number.isFinite(r.f32()));
    r.u8(); r.u16(); r.u8();
    r.u8(); r.u8(); r.u8();
  }
  for (let k = 0; k < FISH.PLANKTON / 8; k++) r.u8();
  const m = r.u8();
  assert.equal(m, game.powers.list.length);
  for (let k = 0; k < m; k++) {
    r.u8();
    assert.ok(r.u8() < FISH_POWERS.length);
    assert.ok(r.u16() <= FISH.WIDTH && r.u16() <= FISH.HEIGHT);
    r.u8();
  }
  assert.equal(r.remaining, 0);
  run(game, room, 40);
  assert.ok(room.results);
  assert.ok(game.ents.some((e) => e.score > 20), 'bots eat');
  assert.deepEqual(room.results.columns, ['Punten', 'Grootst', 'Vissen gehapt']);
});

// A game in play with two human fish, far apart, nothing else going on.
function playing(settings = {}) {
  const room = fakeRoom([human('p1', 0), human('p2', 1)]);
  const game = fish.create(room, { duration: 60, seed: 11, ...settings });
  run(game, room, 3.1);
  game.food.fill(0);
  game.foodBack.fill(99);
  const a = game.ent('p1');
  const b = game.ent('p2');
  Object.assign(a.s, { x: 200, y: 200 });
  Object.assign(b.s, { x: 1000, y: 600 });
  return { room, game, a, b };
}

test('power-ups: bubbles appear, drift and are picked up by touch', () => {
  const { room, game, a } = playing();
  game.powers.list.length = 0;
  run(game, room, 10);
  assert.ok(game.powers.list.length > 0, 'bubbles appear');
  assert.ok(game.powers.list.length <= FISH_POWER_RULES.MAX);
  game.powers.list.length = 0;
  const p = game.powers.spawn(FISH_POWER.TURBO);
  a.s.x = p.x;
  a.s.y = p.y;
  run(game, room, 0.05);
  assert.equal(game.powers.list.length, 0, 'picked up');
  assert.ok(a.s.boost > 0, 'turbo is in the (predicted) fish state');
  assert.ok(room.events.some((e) => e.e === 'power' && e.s === 0 && e.type === FISH_POWER.TURBO));
});

test('turbo is faster; magnet reaches further; double points; grow', () => {
  const s = createFish(300, 400, 30);
  const t = createFish(300, 400, 30);
  t.boost = 5;
  for (let i = 0; i < 40; i++) {
    stepFish(s, 1, 0, 0, DT);
    stepFish(t, 1, 0, 0, DT);
  }
  assert.ok(t.vx > s.vx * 1.3, 'turbo');
  const { room, game, a } = playing();
  game.powers.enabled = false;
  game.powers.list.length = 0;
  // Magnet: plankton just out of normal reach.
  const reach = fishRadius(a.s.mass) + FISH.PLANKTON_R;
  a.s.x = game.spots.xs[5] - reach - 20;
  a.s.y = game.spots.ys[5];
  a.s.vx = a.s.vy = 0;
  game.food[5] = 1;
  run(game, room, 0.05);
  assert.equal(game.food[5], 1, 'out of reach');
  game.powers.apply(a, FISH_POWER.MAGNET);
  a.score = 0;
  run(game, room, 0.05);
  assert.equal(game.food[5], 0, 'the magnet pulls it in');
  assert.equal(a.score, 1);
  // Double points.
  game.powers.apply(a, FISH_POWER.DOUBLE);
  game.food[6] = 1;
  a.s.x = game.spots.xs[6];
  a.s.y = game.spots.ys[6];
  run(game, room, 0.05);
  assert.equal(a.score, 3);
  // Grow.
  const m = a.s.mass;
  game.powers.apply(a, FISH_POWER.GROW);
  assert.equal(a.s.mass, Math.fround(m + FISH_POWER_RULES.GROW));
  // Timers run out.
  run(game, room, 11);
  assert.equal(a.magnet, 0);
  assert.equal(a.double, 0);
});

test('spikes: a spiky fish can not be eaten; the biter shrinks and bounces off', () => {
  const { room, game, a, b } = playing();
  game.powers.enabled = false;
  game.powers.list.length = 0;
  a.s.mass = 100;
  game.powers.apply(b, FISH_POWER.SPIKES);
  b.s.x = a.s.x + 2;
  b.s.y = a.s.y;
  run(game, room, 0.05);
  assert.equal(b.alive, true, 'not eaten');
  assert.ok(a.s.mass < 100 * (1 - FISH_POWER_RULES.SPIKE_LOSS) + 1, 'the biter lost mass');
  assert.ok(room.events.some((e) => e.e === 'spiked' && e.s === 0 && e.v === 1));
  const stings = room.events.filter((e) => e.e === 'spiked').length;
  run(game, room, 0.3);
  assert.equal(room.events.filter((e) => e.e === 'spiked').length, stings, 'one sting per second at most');
  // After the spikes wear off it is fair game again.
  run(game, room, FISH_POWERS[FISH_POWER.SPIKES].seconds);
  b.s.x = a.s.x + 2;
  b.s.y = a.s.y;
  a.s.mass = 100;
  run(game, room, 0.05);
  assert.equal(b.alive, false);
});

test('no power-ups when the setting is off', () => {
  const { room, game } = playing({ powerups: false });
  run(game, room, 30);
  assert.equal(game.powers.list.length, 0);
  assert.ok(!room.events.some((e) => e.e === 'power'));
});

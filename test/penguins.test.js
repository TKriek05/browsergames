// Pinguïnbotsen: deterministic sliding, dashes, bumps (no tunnelling, no
// pile-ups, dash hits stun), power-ups, the melting floe, falling off and
// complete bot matches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import penguins from '../server/games/penguins.js';
import { PG, PG_POWER, PG_POWERS, PG_POWER_RULES, createPenguin, stepPenguin, bump, floeRadius } from '../shared/games/penguins.js';
import { BTN } from '../shared/messages.js';
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
  for (const k of ['x', 'y', 'vx', 'vy', 'fx', 'fy', 'dash', 'cool', 'stun', 'boost', 'grip']) assert.equal(a[k], Math.fround(a[k]), k);
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
    for (let k = 0; k < 11; k++) assert.ok(Number.isFinite(r.f32()));
    r.u8(); r.u8(); r.u8(); r.u8(); r.u8(); r.u8();
  }
  const m = r.u8();
  assert.equal(m, game.powers.list.length);
  for (let k = 0; k < m; k++) {
    r.u8();
    assert.ok(r.u8() < PG_POWERS.length);
    assert.ok(Math.abs(r.i16()) <= PG.FLOE_START * 10 && Math.abs(r.i16()) <= PG.FLOE_START * 10);
    r.u8();
  }
  assert.equal(r.remaining, 0);
});

// --- Collisions and power-ups -------------------------------------------------------------

// Two humans in play; inputs are fed by hand (seq per player).
function arena(settings = {}) {
  const players = [human('p1', 0), human('p2', 1), human('p3', 2)];
  const room = fakeRoom(players);
  const game = penguins.create(room, { seed: 5, powerups: false, ...settings });
  run(game, room, 3.1);
  const seq = new Map();
  const feed = (i, ax, ay, a = 0, n = 1) => {
    for (let k = 0; k < n; k++) {
      const next = (seq.get(i) ?? 0) + 1;
      seq.set(i, next);
      game.onInput(players[i], { seq: next, ax, ay, buttons: a ? BTN.A : 0, aim: 0 });
    }
  };
  const ents = players.map((p) => game.ent(p.id));
  // Park them out of the way: only the ones a test moves take part.
  ents.forEach((e, i) => Object.assign(e.s, createPenguin(-60 + i * 60, 80)));
  return { room, game, ents, feed, tick: () => { room.clock += DT * 1000; game.tick(DT); } };
}

test('fast penguins can not slide through each other (sub-steps)', () => {
  const { game, ents, feed, tick } = arena();
  const [a, b] = ents;
  Object.assign(a.s, createPenguin(-12, 0), { vx: 300, dash: 0.2 });
  Object.assign(b.s, createPenguin(12, 0), { vx: -300, dash: 0.2 });
  // Two inputs each in one tick (a lag spike): 20 units per penguin.
  feed(0, 1, 0, 0, 2);
  feed(1, -1, 0, 0, 2);
  game.ents.forEach((e) => { e.queue.credits = 3; });
  tick();
  assert.ok(a.s.x < b.s.x, 'still on their own side');
  assert.ok(a.s.vx < 0 && b.s.vx > 0, 'bounced back');
  assert.ok(Math.hypot(b.s.x - a.s.x, b.s.y - a.s.y) >= PG.RADIUS * 2 - 0.01);
});

test('a pile-up of three is pulled apart in one tick', () => {
  const { ents, feed, tick } = arena();
  ents.forEach((e, i) => Object.assign(e.s, createPenguin(i * 2, i % 2)));
  ents.forEach((_, i) => feed(i, 0, 0));
  tick();
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const d = Math.hypot(ents[i].s.x - ents[j].s.x, ents[i].s.y - ents[j].s.y);
      assert.ok(d >= PG.RADIUS * 2 - 1.5, `penguins ${i} and ${j} apart (${d.toFixed(2)})`);
    }
  }
});

test('without a bump the server ends exactly where the prediction does', () => {
  const { ents, feed, tick } = arena();
  const [a] = ents;
  Object.assign(a.s, createPenguin(-30, -30));
  const mirror = { ...a.s };
  for (let i = 0; i < 20; i++) {
    feed(0, 0.6, -0.4, i === 5 ? 1 : 0);
    stepPenguin(mirror, 0.6, -0.4, i === 5 ? 1 : 0, DT);
    tick();
  }
  assert.deepEqual({ ...a.s }, mirror);
});

test('a dash hit knocks the other one away and stuns it; the pusher gets the credit', () => {
  const { room, game, ents, feed, tick } = arena();
  const [a, b] = ents;
  Object.assign(a.s, createPenguin(-20, 0));
  Object.assign(b.s, createPenguin(0, 0));
  feed(0, 1, 0, 1); // dash
  feed(1, 0, 0);
  tick();
  for (let i = 0; i < 4 && b.s.stun === 0; i++) {
    feed(0, 1, 0, 1);
    feed(1, 0, 0);
    tick();
  }
  assert.ok(b.s.stun > 0, 'stunned');
  assert.ok(b.s.vx > PG.MAX_SPEED, 'flies off faster than it could run');
  assert.ok(b.s.vx <= PG.KNOCK_MAX + 1e-3);
  assert.equal(b.hit.by, a);
  assert.ok(room.events.some((e) => e.e === 'bump' && e.s === 0));
  // Stunned: no dash, and hardly any steering.
  const v = b.s.vx;
  feed(1, -1, 0, 1);
  feed(0, 0, 0);
  tick();
  assert.equal(b.s.dash, 0);
  assert.ok(b.s.vx > v * 0.6, 'can not stop at once');
  void game;
});

test('heavy: hardly moves when hit; punch: a much bigger knock, used once', () => {
  const hitOnce = (setup) => {
    const { room, game, ents, feed, tick } = arena();
    const [a, b] = ents;
    Object.assign(a.s, createPenguin(-20, 0));
    Object.assign(b.s, createPenguin(0, 0));
    setup(game, a, b);
    for (let i = 0; i < 6 && b.s.stun === 0; i++) {
      feed(0, 1, 0, 1);
      feed(1, 0, 0);
      tick();
    }
    return { speed: b.s.vx, a, room };
  };
  const plain = hitOnce(() => {});
  const heavy = hitOnce((game, a, b) => game.powers.apply(b, PG_POWER.HEAVY));
  const punch = hitOnce((game, a) => game.powers.apply(a, PG_POWER.PUNCH));
  assert.ok(heavy.speed < plain.speed * 0.7, `heavy ${heavy.speed} < plain ${plain.speed}`);
  assert.ok(punch.speed > plain.speed * 1.2, `punch ${punch.speed} > plain ${plain.speed}`);
  assert.equal(punch.a.punch, 0, 'the glove is used up');
  assert.ok(punch.room.events.some((e) => e.e === 'punch' && e.s === 0 && e.v === 1));
});

test('shock wave: everyone close by flies away, stunned', () => {
  const { room, game, ents } = arena();
  const [a, b, c] = ents;
  Object.assign(a.s, createPenguin(0, 0));
  Object.assign(b.s, createPenguin(30, 0));
  Object.assign(c.s, createPenguin(0, -PG_POWER_RULES.SHOCK_RANGE - 20));
  game.powers.apply(a, PG_POWER.SHOCK);
  assert.ok(b.s.vx > 100 && b.s.stun > 0);
  assert.equal(b.hit.by, a);
  assert.equal(c.s.vy, 0, 'out of range');
  assert.ok(room.events.some((e) => e.e === 'shock' && e.s === 0));
});

test('turbo is faster, crampons stop the sliding', () => {
  const run1 = (setup) => {
    const s = createPenguin();
    setup(s);
    for (let i = 0; i < 45; i++) stepPenguin(s, 1, 0, 0, DT);
    const top = s.vx;
    for (let i = 0; i < 15; i++) stepPenguin(s, 0, 0, 0, DT);
    return { top, after: s.vx };
  };
  const plain = run1(() => {});
  const turbo = run1((s) => { s.boost = 5; });
  const grip = run1((s) => { s.grip = 5; });
  assert.ok(turbo.top > plain.top * 1.2);
  assert.ok(grip.after < plain.after * 0.3, 'grip: stops quickly');
});

test('power-ups land on the ice, get picked up, and sink when the floe melts', () => {
  const { room, game, ents, feed, tick } = arena({ powerups: true });
  const [a] = ents;
  game.powers.list.length = 0;
  for (let i = 0; i < 400 && !game.powers.list.length; i++) {
    ents.forEach((_, k) => feed(k, 0, 0));
    tick();
  }
  assert.ok(game.powers.list.length > 0, 'something lands');
  game.powers.list.length = 0;
  const p = game.powers.spawn(PG_POWER.TURBO);
  Object.assign(a.s, createPenguin(p.x, p.y));
  feed(0, 0, 0);
  tick();
  assert.equal(game.powers.list.length, 0);
  assert.ok(a.s.boost > 0);
  assert.ok(room.events.some((e) => e.e === 'power' && e.s === 0 && e.type === PG_POWER.TURBO));
  // Near the edge of a melting floe.
  const q = game.powers.spawn(PG_POWER.GRIP);
  q.x = game.radius - 1;
  q.y = 0;
  tick();
  assert.ok(!game.powers.list.includes(q), 'sunk');
});

test('no power-ups when the setting is off', () => {
  const players = [bot('p1', 0), bot('p2', 1), bot('p3', 2)];
  const room = fakeRoom(players);
  const game = penguins.create(room, { seed: 2, powerups: false });
  run(game, room, 60);
  assert.equal(game.powers.list.length, 0);
  assert.ok(!room.events.some((e) => e.e === 'power'));
});

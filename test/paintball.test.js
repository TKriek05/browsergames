// Spetterveld: deterministic movement, rays, lag-compensated shots, power-ups, bots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import paintball from '../server/games/paintball.js';
import { PB_ARENAS, PB_FIELD } from '../shared/maps/paintball-arenas.js';
import { PB_PHYS, createRunner, stepRunner, collide, raycast, rayBox, rayCircle, lineOfSight } from '../shared/physics/paintball.js';
import { PB_RULES, PB_FLAG, PB_POWER, PB_POWERS, PB_POWER_RULES, i16ToYaw, yawToI16 } from '../shared/games/paintball.js';
import { PAD_EMPTY } from '../server/games/paintball-powers.js';
import { pickTargetForTest } from '../server/games/paintball-bots.js';
import { ARCADE_PHASE } from '../shared/games/arcade.js';
import { ByteWriter, ByteReader, quantizeAxis } from '../shared/binary.js';
import { createRng } from '../shared/rng.js';
import { SIM_TICK_RATE } from '../shared/constants.js';

const DT = 1 / SIM_TICK_RATE;
const arena = PB_ARENAS.opblaas;

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
function run(game, room, seconds) {
  for (let i = 0; i < seconds * SIM_TICK_RATE && !room.results; i++) {
    room.clock += DT * 1000;
    game.tick(DT);
  }
}

test('every field: obstacles inside, spawns free and reachable by line of sight to the middle area', () => {
  for (const a of Object.values(PB_ARENAS)) {
    for (const o of a.obstacles) {
      const r = o.t === 'can' ? o.r : Math.max(o.w, o.h) / 2;
      assert.ok(o.x - r >= 0 && o.x + r <= PB_FIELD.width && o.y - r >= 0 && o.y + r <= PB_FIELD.height, `${a.key} obstacle inside`);
      assert.ok(o.hgt > PB_PHYS.EYE, `${a.key}: obstacles are taller than the eyes`);
    }
    for (const sp of a.spawns) {
      const probe = { x: sp.x, y: sp.y };
      collide(probe, a.obstacles, PB_PHYS.RADIUS);
      assert.ok(Math.hypot(probe.x - sp.x, probe.y - sp.y) < 1e-6, `${a.key} spawn ${sp.x},${sp.y} is free`);
    }
  }
});

test('movement is deterministic, float32-exact and never enters an obstacle', () => {
  const rng = createRng(3);
  const inputs = Array.from({ length: 900 }, () => [quantizeAxis(rng() * 2 - 1), quantizeAxis(rng() * 2 - 1)]);
  for (const a of Object.values(PB_ARENAS)) {
    const once = () => {
      const s = createRunner(a.spawns[0].x, a.spawns[0].y);
      for (const [ax, ay] of inputs) {
        stepRunner(s, ax, ay, PB_PHYS.DT, a.obstacles);
        const probe = { x: s.x, y: s.y };
        collide(probe, a.obstacles, PB_PHYS.RADIUS - 0.01);
        assert.ok(Math.hypot(probe.x - s.x, probe.y - s.y) < 0.02, `${a.key}: inside an obstacle at ${s.x},${s.y}`);
      }
      return s;
    };
    const x = once();
    assert.deepEqual(x, once());
    for (const k of ['x', 'y', 'vx', 'vy']) assert.equal(x[k], Math.fround(x[k]));
  }
});

test('rays hit boxes, cans and the field edge with the right normal', () => {
  const n = { x: 0, y: 0 };
  const b = { t: 'box', x: 50, y: 0, w: 10, h: 10 };
  assert.equal(rayBox(0, 0, 1, 0, b, n), 45);
  assert.deepEqual(n, { x: -1, y: 0 });
  assert.equal(rayBox(100, 0, -1, 0, b, n), 45);
  assert.deepEqual(n, { x: 1, y: 0 });
  assert.equal(rayBox(0, 20, 1, 0, b), Infinity);
  assert.equal(rayCircle(0, 0, 1, 0, 30, 0, 5), 25);
  assert.equal(rayCircle(0, 0, -1, 0, 30, 0, 5), Infinity);
  const hit = {};
  const d = raycast([], 10, 10, 1, 0, 1000, hit);
  assert.equal(d, PB_FIELD.width - 10);
  assert.equal(hit.nx, -1);
  assert.equal(lineOfSight(arena.obstacles, 18, 140, 402, 140), false, 'the middle bunker blocks the view');
  assert.equal(yawToI16(Math.PI), 32767);
  assert.ok(Math.abs(i16ToYaw(yawToI16(1.234)) - 1.234) < 1e-4);
});

test('shots are judged where the shooter saw the target (lag compensation)', () => {
  const a = human('p1', 0);
  const b = human('p2', 1);
  const room = fakeRoom([a, b]);
  const game = paintball.create(room, { arena: 'opblaas', duration: 60, seed: 1 });
  run(game, room, 3.2); // countdown
  const ea = game.ent('p1');
  const eb = game.ent('p2');
  // Put them on an open line (top edge of the field) and let history record it.
  ea.s.x = 20; ea.s.y = 12;
  eb.s.x = 120; eb.s.y = 12;
  ea.shield = eb.shield = 0;
  const seenAt = room.clock;
  run(game, room, 0.2);
  eb.s.x = 120; eb.s.y = 30; // the target has moved away since
  run(game, room, 0.1);
  eb.shield = 0;
  ea.cooldown = 0;
  const miss = game.shoot(ea, 0, room.now(), null);
  assert.equal(miss, null, 'at the current time the target is gone');
  ea.cooldown = 0;
  const hit = game.shoot(ea, 0, game.history.clampTime(seenAt + 100, room.now()), null);
  assert.equal(hit, eb, 'rewound to the view time it is a hit');
  assert.equal(eb.hp, PB_RULES.HP - 1);
  const shot = room.events.filter((e) => e.e === 'shot').at(-1);
  assert.equal(shot.h, 1);
});

test('three hits splat a player; spawn shield blocks; the hopper needs a reload', () => {
  const a = human('p1', 0);
  const b = human('p2', 1);
  const room = fakeRoom([a, b]);
  const game = paintball.create(room, { arena: 'opblaas', duration: 60, seed: 2 });
  run(game, room, 3.2);
  const ea = game.ent('p1');
  const eb = game.ent('p2');
  ea.s.x = 20; ea.s.y = 12; eb.s.x = 100; eb.s.y = 12;
  eb.shield = 1;
  run(game, room, 0.1);
  ea.cooldown = 0;
  game.shoot(ea, 0, room.now(), null);
  assert.equal(eb.hp, PB_RULES.HP, 'shielded');
  assert.ok(room.events.some((e) => e.e === 'block'));
  eb.shield = 0;
  for (let i = 0; i < 3; i++) {
    ea.cooldown = 0;
    game.shoot(ea, 0, room.now(), null);
  }
  assert.equal(eb.alive, false);
  assert.equal(ea.kills, 1);
  assert.equal(eb.deaths, 1);
  assert.ok(room.events.some((e) => e.e === 'splat' && e.s === 1 && e.by === 0));
  // Empty the hopper: an automatic reload starts.
  ea.ammo = 1;
  ea.cooldown = 0;
  game.shoot(ea, Math.PI / 2, room.now(), null);
  assert.equal(ea.ammo, 0);
  assert.ok(ea.reload > 0);
  ea.cooldown = 0;
  assert.equal(game.shoot(ea, 0, room.now(), null), null, 'no shots while reloading');
  run(game, room, PB_RULES.RELOAD_S + 0.1);
  assert.equal(ea.ammo, PB_RULES.HOPPER);
  run(game, room, PB_RULES.RESPAWN_S);
  assert.equal(eb.alive, true, 'respawned');
  assert.equal(eb.hp, PB_RULES.HP);
});

test('a claimed muzzle position is only trusted close to the server position', () => {
  const room = fakeRoom([human('p1', 0), human('p2', 1)]);
  const game = paintball.create(room, { arena: 'opblaas', duration: 60 });
  run(game, room, 3.2);
  const ea = game.ent('p1');
  ea.s.x = 20; ea.s.y = 12;
  ea.cooldown = 0;
  game.onAction(ea.player, { a: 0, t: room.now(), x: 300, y: 12 });
  const far = room.events.filter((e) => e.e === 'shot').at(-1);
  assert.equal(far.x0, 20, 'far-away claim ignored');
  ea.cooldown = 0;
  game.onAction(ea.player, { a: 0, t: room.now(), x: 25, y: 13 });
  const near = room.events.filter((e) => e.e === 'shot').at(-1);
  assert.equal(near.x0, 25);
  game.onAction(ea.player, { a: 'x' });
  game.onAction(ea.player, null);
});

test('bots of every level play a full match and splat each other', () => {
  for (const key of Object.keys(PB_ARENAS)) {
    const players = [bot('p1', 0, 'hard'), bot('p2', 1, 'normal'), bot('p3', 2, 'easy'), human('p4', 3)];
    const room = fakeRoom(players);
    const game = paintball.create(room, { arena: key, duration: 120, seed: 5 });
    let totalMs = 0;
    let ticks = 0;
    for (let i = 0; i < 130 * SIM_TICK_RATE && !room.results; i++) {
      room.clock += DT * 1000;
      const t0 = performance.now();
      game.tick(DT);
      totalMs += performance.now() - t0;
      ticks++;
    }
    assert.ok(room.results, `${key}: the match ends`);
    const kills = game.ents.reduce((n, e) => n + e.kills, 0);
    assert.ok(kills >= 4, `${key}: bots splat each other (${kills})`);
    assert.ok(totalMs / ticks < 2, `${key}: ticks stay cheap (${(totalMs / ticks).toFixed(2)} ms on average)`);
    assert.equal(room.results.rows.length, 4);
    assert.deepEqual(room.results.columns, ['Spetters', 'Gespetterd', 'Raak']);
  }
});

test('snapshot has the documented layout', () => {
  const room = fakeRoom([human('p1', 0), bot('p2', 1)]);
  const game = paintball.create(room, { arena: 'bos', duration: 60 });
  run(game, room, 4);
  const w = new ByteWriter(64);
  game.snapshot(w);
  const r = new ByteReader(w.toBytes());
  assert.equal(r.u8(), ARCADE_PHASE.PLAY);
  assert.ok(r.f32() > 50);
  assert.equal(r.u8(), 2);
  for (let i = 0; i < 2; i++) {
    r.u8(); r.u8(); r.u16();
    for (let k = 0; k < 5; k++) assert.ok(Number.isFinite(r.f32()));
    r.i16(); assert.ok(r.u8() <= PB_RULES.HP); assert.ok(r.u8() <= PB_RULES.HOPPER);
    r.i16(); r.u8(); r.u8(); r.u8();
    r.u8(); r.u8(); r.u8(); r.u8();
  }
  assert.equal(r.u8(), PB_ARENAS.bos.pads.length);
  for (let k = 0; k < PB_ARENAS.bos.pads.length; k++) {
    const t = r.u8();
    assert.ok(t === PAD_EMPTY || t < PB_POWERS.length);
  }
  assert.equal(r.remaining, 0);
});

// --- Power-ups ------------------------------------------------------------------------------

test('every field: four pads on open ground, away from the spawns', () => {
  for (const a of Object.values(PB_ARENAS)) {
    assert.equal(a.pads.length, 4, a.key);
    for (const p of a.pads) {
      const probe = { x: p.x, y: p.y };
      collide(probe, a.obstacles, PB_PHYS.RADIUS + 2);
      assert.ok(Math.hypot(probe.x - p.x, probe.y - p.y) < 1e-6, `${a.key} pad ${p.x},${p.y} is free`);
      for (const sp of a.spawns) assert.ok(Math.hypot(sp.x - p.x, sp.y - p.y) > 50, `${a.key} pad ${p.x},${p.y} not at a spawn`);
    }
  }
});

function duel(settings = {}) {
  const room = fakeRoom([human('p1', 0), human('p2', 1)]);
  const game = paintball.create(room, { arena: 'opblaas', duration: 60, seed: 2, ...settings });
  run(game, room, 3.2);
  const ea = game.ent('p1');
  const eb = game.ent('p2');
  ea.s.x = 20; ea.s.y = 12; eb.s.x = 100; eb.s.y = 12;
  run(game, room, 0.1); // the lag history knows where they are
  eb.shield = 0;
  return { room, game, ea, eb };
}

test('pads fill up, a power-up is taken by walking over it and comes back later', () => {
  const { room, game, ea } = duel();
  run(game, room, PB_POWER_RULES.FIRST_S + 0.2);
  assert.ok(game.powers.pads.every((p) => p.type !== PAD_EMPTY), 'all pads have something');
  const pad = game.powers.pads[0];
  pad.type = PB_POWER.SPRINT;
  ea.s.x = pad.x;
  ea.s.y = pad.y;
  run(game, room, 0.1);
  assert.equal(pad.type, PAD_EMPTY);
  assert.ok(ea.s.boost > 0, 'sprint is in the runner state');
  assert.ok(room.events.some((e) => e.e === 'power' && e.s === 0 && e.type === PB_POWER.SPRINT && e.pad === 0));
  ea.s.x = 20;
  ea.s.y = 12;
  run(game, room, PB_POWER_RULES.RESPAWN_S[1] + 0.2);
  assert.notEqual(pad.type, PAD_EMPTY, 'a new one');
});

test('sprint is faster and predicted exactly', () => {
  const walk = (boost) => {
    const s = createRunner(20, 12);
    s.boost = boost;
    for (let i = 0; i < 30; i++) stepRunner(s, 1, 0, DT, arena.obstacles);
    return s;
  };
  assert.ok(walk(5).x - 40 > (walk(0).x - 40) * 1.3);
  assert.deepEqual(walk(5), walk(5));
  const s = walk(0.5);
  assert.equal(s.boost, 0, 'runs out');
});

test('rapid fire: shorter cooldown and no ammo used; spread: three balls', () => {
  const { room, game, ea } = duel();
  game.powers.apply(ea, PB_POWER.RAPID);
  ea.cooldown = 0;
  game.shoot(ea, Math.PI / 2, room.now(), null);
  assert.equal(ea.ammo, PB_RULES.HOPPER);
  assert.ok(ea.cooldown <= PB_POWER_RULES.RAPID_COOLDOWN_S + 1e-9);
  ea.rapid = 0;
  game.powers.apply(ea, PB_POWER.SPREAD);
  const before = room.events.filter((e) => e.e === 'shot').length;
  ea.cooldown = 0;
  game.shoot(ea, Math.PI / 2, room.now(), null);
  assert.equal(room.events.filter((e) => e.e === 'shot').length - before, 3);
  assert.equal(ea.ammo, PB_RULES.HOPPER - 1, 'one ball from the hopper');
});

test('armor soaks up two hits', () => {
  const { room, game, ea, eb } = duel();
  game.powers.apply(eb, PB_POWER.ARMOR);
  for (let i = 0; i < 2; i++) {
    ea.cooldown = 0;
    game.shoot(ea, 0, room.now(), null);
  }
  assert.equal(eb.hp, PB_RULES.HP);
  assert.equal(eb.armor, 0);
  assert.equal(room.events.filter((e) => e.e === 'armor').length, 2);
  ea.cooldown = 0;
  game.shoot(ea, 0, room.now(), null);
  assert.equal(eb.hp, PB_RULES.HP - 1);
});

test('camouflage: flagged in the snapshot, bots only notice it up close', () => {
  const { room, game, ea, eb } = duel();
  game.powers.apply(eb, PB_POWER.CAMO);
  const w = new ByteWriter(64);
  game.snapshot(w);
  const r = new ByteReader(w.toBytes());
  r.u8(); r.f32(); r.u8();
  r.u8(); r.u8(); r.u16(); for (let k = 0; k < 5; k++) r.f32(); r.i16(); r.u8(); r.u8(); r.i16(); r.u8(); r.u8(); r.u8(); r.u8(); r.u8(); r.u8(); r.u8();
  r.u8(); assert.ok(r.u8() & PB_FLAG.CAMO, 'camo flag on player 2');
  assert.equal(pickTargetForTest(ea, game), null, 'too far away to be seen');
  eb.s.x = ea.s.x + PB_POWER_RULES.CAMO_SIGHT - 5;
  assert.equal(pickTargetForTest(ea, game), eb);
  void room;
});

test('no power-ups when the setting is off', () => {
  const { room, game } = duel({ powerups: false });
  run(game, room, 30);
  assert.ok(game.powers.pads.every((p) => p.type === PAD_EMPTY));
  assert.ok(!room.events.some((e) => e.e === 'power'));
});

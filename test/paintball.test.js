// Spetterveld: deterministic movement, rays, lag-compensated shots, bots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import paintball from '../server/games/paintball.js';
import { PB_ARENAS, PB_FIELD } from '../shared/maps/paintball-arenas.js';
import { PB_PHYS, createRunner, stepRunner, collide, raycast, rayBox, rayCircle, lineOfSight } from '../shared/physics/paintball.js';
import { PB_RULES, i16ToYaw, yawToI16 } from '../shared/games/paintball.js';
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
    let maxMs = 0;
    for (let i = 0; i < 130 * SIM_TICK_RATE && !room.results; i++) {
      room.clock += DT * 1000;
      const t0 = performance.now();
      game.tick(DT);
      maxMs = Math.max(maxMs, performance.now() - t0);
    }
    assert.ok(room.results, `${key}: the match ends`);
    const kills = game.ents.reduce((n, e) => n + e.kills, 0);
    assert.ok(kills >= 4, `${key}: bots splat each other (${kills})`);
    assert.ok(maxMs < 20, `${key}: tick stays cheap (${maxMs.toFixed(1)} ms)`);
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
    for (let k = 0; k < 4; k++) assert.ok(Number.isFinite(r.f32()));
    r.i16(); assert.ok(r.u8() <= PB_RULES.HP); assert.ok(r.u8() <= PB_RULES.HOPPER);
    r.i16(); r.u8(); r.u8(); r.u8();
  }
  assert.equal(r.remaining, 0);
});

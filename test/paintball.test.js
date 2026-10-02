// Spetterveld: deterministic 3D movement (stairs, jumps, ceilings), rays,
// lag-compensated shots, power-ups, bot navigation over several levels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import paintball from '../server/games/paintball.js';
import { PB_ARENAS } from '../shared/maps/paintball-arenas.js';
import { PB_LEVELS } from '../shared/maps/paintball-levels.js';
import { STOREY } from '../shared/maps/paintball-build.js';
import {
  PB_PHYS, PB_STANCE, JUMP_REACH, createRunner, stepRunner, collide, raycast, rayBox, rayCylinder, lineOfSight, groundHeight, standsFree,
} from '../shared/physics/paintball.js';
import { BTN } from '../shared/messages.js';
import { PB_RULES, PB_FLAG, PB_POWER, PB_POWERS, PB_POWER_RULES, i16ToYaw, yawToI16 } from '../shared/games/paintball.js';
import { PAD_EMPTY } from '../server/games/paintball-powers.js';
import { pickTargetForTest, goToForTest, stepPaintBot } from '../server/games/paintball-bots.js';
import { navFor, nodeAt, reachable } from '../server/games/paintball-nav.js';
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
// Walk (ax, ay) for a number of ticks, jumping while `jump` (or with these buttons held).
function walk(s, level, ax, ay, ticks, jump = false) {
  const buttons = typeof jump === 'number' ? jump : jump ? BTN.X : 0;
  for (let i = 0; i < ticks; i++) stepRunner(s, ax, ay, buttons, DT, level);
  return s;
}

test('every field: solids inside, spawns and pads free, on a surface and reachable from every spawn', () => {
  for (const a of Object.values(PB_ARENAS)) {
    for (const o of a.solids) {
      const rx = o.t === 'can' ? o.r : o.w / 2;
      const ry = o.t === 'can' ? o.r : o.h / 2;
      assert.ok(o.x - rx >= -0.01 && o.x + rx <= a.width + 0.01 && o.y - ry >= -0.01 && o.y + ry <= a.height + 0.01, `${a.key} solid inside (${o.kind} ${o.x},${o.y})`);
      assert.ok(o.z1 > o.z0, `${a.key}: solid has a height`);
    }
    const nav = navFor(a);
    for (const sp of a.spawns) {
      assert.ok(standsFree(a, sp.x, sp.y, sp.z), `${a.key} spawn ${sp.x},${sp.y} is free`);
      const seen = reachable(nav, nodeAt(nav, sp.x, sp.y, sp.z));
      for (const p of [...a.spawns, ...a.pads]) {
        assert.equal(groundHeight(a, p.x, p.y, PB_PHYS.RADIUS - 0.5, p.z + PB_PHYS.STEP), p.z, `${a.key} ${p.x},${p.y} stands at ${p.z}`);
        assert.ok(seen[nodeAt(nav, p.x, p.y, p.z)], `${a.key}: ${p.x},${p.y},${p.z} reachable from spawn ${sp.x},${sp.y}`);
      }
    }
  }
});

test('the big fields: every floor you can stand on is reachable', () => {
  for (const a of Object.values(PB_LEVELS)) {
    const nav = navFor(a);
    const seen = reachable(nav, nodeAt(nav, a.spawns[0].x, a.spawns[0].y, 0));
    let floors = 0;
    let reached = 0;
    for (let k = 0; k < nav.count; k++) {
      if (Math.abs(nav.height[k] - STOREY) > 0.01) continue;
      floors++;
      if (seen[k]) reached++;
    }
    assert.ok(floors > 100, `${a.key} has upper floors (${floors})`);
    assert.equal(reached, floors, `${a.key}: every upper floor spot is reachable`);
  }
});

test('movement is deterministic, float32-exact and never enters a solid', () => {
  const rng = createRng(3);
  const pick = () => {
    const r = rng();
    return r < 0.1 ? BTN.X : r < 0.13 ? BTN.Y : r < 0.16 ? BTN.R : r < 0.18 ? BTN.L : 0;
  };
  const inputs = Array.from({ length: 900 }, () => [quantizeAxis(rng() * 2 - 1), quantizeAxis(rng() * 2 - 1), pick()]);
  for (const a of Object.values(PB_ARENAS)) {
    const once = () => {
      const s = createRunner(a.spawns[0].x, a.spawns[0].y, a.spawns[0].z);
      for (const [ax, ay, buttons] of inputs) {
        stepRunner(s, ax, ay, buttons, PB_PHYS.DT, a);
        const probe = { x: s.x, y: s.y, z: s.z, stance: s.stance };
        collide(probe, a, PB_PHYS.RADIUS - 0.01);
        assert.ok(Math.hypot(probe.x - s.x, probe.y - s.y) < 0.02, `${a.key}: inside a solid at ${s.x},${s.y},${s.z}`);
        assert.ok(s.z >= 0);
      }
      return s;
    };
    const x = once();
    assert.deepEqual(x, once());
    for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz']) assert.equal(x[k], Math.fround(x[k]));
  }
});

test('stairs lead up to the deck and back down; walls stop you', () => {
  const a = PB_LEVELS.bouw;
  // The west staircase inside the building: from x 216 to 228, climbing from y 150 to 198 (southwards).
  const s = createRunner(222, 147, 0);
  s.y = 152;
  walk(s, a, 0, 1, 45);
  assert.equal(s.z, STOREY, `up the stairs (${s.z})`);
  walk(s, a, 1, 0, 20); // onto the deck
  assert.equal(s.z, STOREY);
  assert.ok(s.x > 235);
  walk(s, a, -1, 0, 20);
  walk(s, a, 0, -1, 60); // back down
  assert.ok(s.z < 4, `down again (${s.z})`);
  // Outside, walking west into the building's wall: it stops you.
  const w = createRunner(190, 190, 0);
  walk(w, a, 1, 0, 40);
  assert.ok(w.x <= 211 - PB_PHYS.RADIUS + 0.01, `stopped by the wall (${w.x})`);
});

test('jumping: onto a crate, not onto a double crate, and a ceiling stops you', () => {
  const a = { key: 't', width: 200, height: 200, solids: [
    { t: 'box', x: 60, y: 100, w: 10, h: 10, z0: 0, z1: 8 },
    { t: 'box', x: 140, y: 100, w: 10, h: 10, z0: 0, z1: 16 },
    { t: 'box', x: 100, y: 40, w: 40, h: 40, z0: 22, z1: 24 },
  ] };
  assert.ok(JUMP_REACH > 8 && JUMP_REACH < 16);
  const s = walk(createRunner(30, 100, 0), a, 1, 0, 12); // run up …
  walk(s, a, 1, 0, 3, true); // … jump …
  for (let i = 0; i < 30 && !(s.ground && s.z > 0); i++) stepRunner(s, 1, 0, 0, DT, a); // … until we land
  walk(s, a, 0, 0, 10); // stop
  assert.equal(s.z, 8, 'on the crate');
  const t = walk(createRunner(120, 100, 0), a, 1, 0, 40, true);
  assert.ok(t.x < 135 - PB_PHYS.RADIUS + 0.01 && t.z < 16, 'the double crate is too high');
  // Under a low ceiling (22) the head (17) stops the jump at 5.
  const u = createRunner(100, 40, 0);
  let top = 0;
  for (let i = 0; i < 30; i++) {
    stepRunner(u, 0, 0, i === 0 ? BTN.X : 0, DT, a);
    top = Math.max(top, u.z);
  }
  assert.ok(top <= 22 - PB_PHYS.HEIGHT + 1e-4, `head against the ceiling (${top})`);
  assert.equal(u.z, 0, 'lands again');
  // Walking off the crate: you fall down.
  const f = createRunner(60, 100, 8);
  walk(f, a, -1, 0, 30);
  assert.equal(f.z, 0);
});

test('3D rays hit boxes, cylinders, the ground and the field edge with the right normal', () => {
  const n = {};
  const b = { x: 50, y: 0, w: 10, h: 10, z0: 0, z1: 10 };
  assert.equal(rayBox(0, 0, 5, 1, 0, 0, b, n), 45);
  assert.deepEqual(n, { x: -1, y: 0, z: 0 });
  assert.equal(rayBox(0, 0, 15, 1, 0, 0, b), Infinity, 'over it');
  const d = Math.SQRT1_2;
  assert.ok(Math.abs(rayBox(50, 0, 20, 0, 0, -1, b, n) - 10) < 1e-9);
  assert.deepEqual(n, { x: 0, y: 0, z: 1 });
  assert.ok(Math.abs(rayCylinder(0, 0, 5, 1, 0, 0, 30, 0, 5, 0, 10, n) - 25) < 1e-9);
  assert.equal(n.x, -1);
  assert.equal(rayCylinder(0, 0, 12, 1, 0, 0, 30, 0, 5, 0, 10), Infinity);
  const hit = {};
  assert.ok(Math.abs(raycast({ width: 420, height: 280, solids: [] }, 10, 10, 15, d, 0, -d, 1000, hit) - 15 / d) < 1e-9);
  assert.equal(hit.solid, -2);
  assert.equal(hit.nz, 1);
  assert.equal(raycast({ width: 420, height: 280, solids: [] }, 10, 10, 15, 1, 0, 0, 1000, hit), 410);
  assert.equal(hit.nx, -1);
  assert.equal(lineOfSight(arena, 18, 140, 15, 402, 140, 15), false, 'the middle bunker blocks the view');
  const low = { key: 'l', width: 100, height: 100, solids: [{ t: 'box', x: 50, y: 50, w: 4, h: 40, z0: 0, z1: 14 }] };
  assert.equal(lineOfSight(low, 20, 50, 15, 80, 50, 15), true, 'eyes see over a low wall');
  assert.equal(lineOfSight(low, 20, 50, 10, 80, 50, 10), false, 'but a chest behind it is covered');
  assert.equal(yawToI16(Math.PI), 32767);
  assert.ok(Math.abs(i16ToYaw(yawToI16(1.234)) - 1.234) < 1e-4);
});

test('from the deck you shoot down at a player below (pitch)', () => {
  const room = fakeRoom([human('p1', 0), human('p2', 1)]);
  const game = paintball.create(room, { arena: 'bouw', duration: 60 });
  run(game, room, 3.2);
  const ea = game.ent('p1');
  const eb = game.ent('p2');
  ea.s.x = 280; ea.s.y = 150; ea.s.z = STOREY; // on the deck, at the north edge
  eb.s.x = 280; eb.s.y = 90; eb.s.z = 0; // down on the ground in front of the building
  ea.shield = eb.shield = 0;
  run(game, room, 0.1);
  const eye = STOREY + PB_PHYS.EYE;
  const dy = eb.s.y - ea.s.y;
  const pitch = Math.atan2(10 - eye, Math.abs(dy));
  ea.cooldown = 0;
  assert.equal(game.shoot(ea, -Math.PI / 2, 0, room.now(), null), null, 'looking straight ahead goes over him');
  ea.cooldown = 0;
  assert.equal(game.shoot(ea, -Math.PI / 2, pitch, room.now(), null), eb, 'looking down hits');
  const shot = room.events.filter((e) => e.e === 'shot').at(-1);
  assert.ok(shot.z1 < shot.z0);
});

test('bots find their way to every pad, also up the stairs and onto the walls', () => {
  for (const a of Object.values(PB_LEVELS)) {
    const room = fakeRoom([bot('p1', 0, 'hard')]);
    const game = paintball.create(room, { arena: a.key, duration: 300, powerups: false });
    run(game, room, 3.2);
    const e = game.ents[0];
    for (const pad of a.pads) {
      goToForTest(e, game, pad.x, pad.y, pad.z);
      let ok = false;
      for (let i = 0; i < 90 * SIM_TICK_RATE && !ok; i++) {
        const b = stepPaintBot(e, game, DT, game.rng);
        stepRunner(e.s, b.ax, b.ay, b.buttons, DT, a);
        e.yaw = b.yaw;
        ok = Math.hypot(e.s.x - pad.x, e.s.y - pad.y) < 8 && Math.abs(e.s.z - pad.z) < 1;
      }
      assert.ok(ok, `${a.key}: bot reached the pad at ${pad.x},${pad.y},${pad.z} (stuck at ${e.s.x.toFixed(0)},${e.s.y.toFixed(0)},${e.s.z.toFixed(1)})`);
    }
  }
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
  const miss = game.shoot(ea, 0, 0, room.now(), null);
  assert.equal(miss, null, 'at the current time the target is gone');
  ea.cooldown = 0;
  const hit = game.shoot(ea, 0, 0, game.history.clampTime(seenAt + 100, room.now()), null);
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
  game.shoot(ea, 0, 0, room.now(), null);
  assert.equal(eb.hp, PB_RULES.HP, 'shielded');
  assert.ok(room.events.some((e) => e.e === 'block'));
  eb.shield = 0;
  for (let i = 0; i < 3; i++) {
    ea.cooldown = 0;
    game.shoot(ea, 0, 0, room.now(), null);
  }
  assert.equal(eb.alive, false);
  assert.equal(ea.kills, 1);
  assert.equal(eb.deaths, 1);
  assert.ok(room.events.some((e) => e.e === 'splat' && e.s === 1 && e.by === 0));
  // Empty the hopper: an automatic reload starts.
  ea.ammo = 1;
  ea.cooldown = 0;
  game.shoot(ea, Math.PI / 2, 0, room.now(), null);
  assert.equal(ea.ammo, 0);
  assert.ok(ea.reload > 0);
  ea.cooldown = 0;
  assert.equal(game.shoot(ea, 0, 0, room.now(), null), null, 'no shots while reloading');
  run(game, room, PB_RULES.RELOAD_S + 0.1);
  assert.equal(ea.ammo, PB_RULES.HOPPER);
  run(game, room, PB_RULES.RESPAWN_S);
  assert.equal(eb.alive, true, 'respawned');
  assert.equal(eb.hp, PB_RULES.HP);
});

test('a claimed eye position is only trusted close to the server position, never through a wall', () => {
  const room = fakeRoom([human('p1', 0), human('p2', 1)]);
  const game = paintball.create(room, { arena: 'bouw', duration: 60 });
  run(game, room, 3.2);
  const ea = game.ent('p1');
  ea.s.x = 20; ea.s.y = 20; ea.s.z = 0;
  ea.cooldown = 0;
  game.onAction(ea.player, { a: 0, p: 0, t: room.now(), x: 300, y: 20, z: 15 });
  const far = room.events.filter((e) => e.e === 'shot').at(-1);
  assert.equal(far.x0, 20, 'far-away claim ignored');
  ea.cooldown = 0;
  game.onAction(ea.player, { a: 0, p: 0, t: room.now(), x: 25, y: 21, z: 15 });
  const near = room.events.filter((e) => e.e === 'shot').at(-1);
  assert.equal(near.x0, 25);
  // Right next to the building's west wall (x 209 … 211): a claim on the other side is ignored.
  ea.s.x = 204; ea.s.y = 170; ea.s.z = 0;
  ea.cooldown = 0;
  game.onAction(ea.player, { a: 0, p: 0, t: room.now(), x: 214, y: 170, z: 15 });
  const wall = room.events.filter((e) => e.e === 'shot').at(-1);
  assert.equal(wall.x0, 204, 'not through the wall');
  game.onAction(ea.player, { p: 0.5 });
  assert.equal(ea.pitch, 0.5, 'where you look is remembered');
  game.onAction(ea.player, { p: 9 });
  assert.equal(ea.pitch, PB_RULES.MAX_PITCH);
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
    assert.ok(totalMs / ticks < 3, `${key}: ticks stay cheap (${(totalMs / ticks).toFixed(2)} ms on average)`);
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
    for (let k = 0; k < 7; k++) assert.ok(Number.isFinite(r.f32()));
    const body = r.u8();
    assert.ok((body & 1) <= 1 && ((body >> 1) & 3) <= 2 && body < 128, 'ground, stance and held buttons');
    r.i16(); r.i16(); assert.ok(r.u8() <= PB_RULES.HP); assert.ok(r.u8() <= PB_RULES.HOPPER);
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

test('every field: four pads with room around them, away from the spawns', () => {
  for (const a of Object.values(PB_ARENAS)) {
    assert.equal(a.pads.length, 4, a.key);
    for (const p of a.pads) {
      assert.ok(standsFree(a, p.x, p.y, p.z, PB_PHYS.RADIUS + 2), `${a.key} pad ${p.x},${p.y} is free`);
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
  const run1 = (boost) => {
    const s = createRunner(20, 12);
    s.boost = boost;
    return walk(s, arena, 1, 0, 30);
  };
  assert.ok(run1(5).x - 40 > (run1(0).x - 40) * 1.3);
  assert.deepEqual(run1(5), run1(5));
  const s = run1(0.5);
  assert.equal(s.boost, 0, 'runs out');
});

test('rapid fire: shorter cooldown and no ammo used; spread: three balls', () => {
  const { room, game, ea } = duel();
  game.powers.apply(ea, PB_POWER.RAPID);
  ea.cooldown = 0;
  game.shoot(ea, Math.PI / 2, 0, room.now(), null);
  assert.equal(ea.ammo, PB_RULES.HOPPER);
  assert.ok(ea.cooldown <= PB_POWER_RULES.RAPID_COOLDOWN_S + 1e-9);
  ea.rapid = 0;
  game.powers.apply(ea, PB_POWER.SPREAD);
  const before = room.events.filter((e) => e.e === 'shot').length;
  ea.cooldown = 0;
  game.shoot(ea, Math.PI / 2, 0, room.now(), null);
  assert.equal(room.events.filter((e) => e.e === 'shot').length - before, 3);
  assert.equal(ea.ammo, PB_RULES.HOPPER - 1, 'one ball from the hopper');
});

test('armor soaks up two hits', () => {
  const { room, game, ea, eb } = duel();
  game.powers.apply(eb, PB_POWER.ARMOR);
  for (let i = 0; i < 2; i++) {
    ea.cooldown = 0;
    game.shoot(ea, 0, 0, room.now(), null);
  }
  assert.equal(eb.hp, PB_RULES.HP);
  assert.equal(eb.armor, 0);
  assert.equal(room.events.filter((e) => e.e === 'armor').length, 2);
  ea.cooldown = 0;
  game.shoot(ea, 0, 0, room.now(), null);
  assert.equal(eb.hp, PB_RULES.HP - 1);
});

test('camouflage: flagged in the snapshot, bots only notice it up close', () => {
  const { room, game, ea, eb } = duel();
  game.powers.apply(eb, PB_POWER.CAMO);
  const w = new ByteWriter(64);
  game.snapshot(w);
  const r = new ByteReader(w.toBytes());
  r.u8(); r.f32(); r.u8();
  r.u8(); r.u8(); r.u16(); for (let k = 0; k < 7; k++) r.f32(); r.u8(); r.i16(); r.i16(); r.u8(); r.u8(); r.i16(); r.u8(); r.u8(); r.u8(); r.u8(); r.u8(); r.u8(); r.u8();
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

// --- Crouching and lying down ------------------------------------------------------------------

const open = { key: 'open', width: 300, height: 300, solids: [] };
// One tick with these buttons held, then one tick with nothing (a tap).
function tap(s, level, buttons) {
  stepRunner(s, 0, 0, buttons, DT, level);
  stepRunner(s, 0, 0, 0, DT, level);
}

test('Shift (Y) cycles stand, crouch, lie down; C (R) and Z (L) toggle; jumping stands you up', () => {
  const s = createRunner(150, 150, 0);
  tap(s, open, BTN.Y);
  assert.equal(s.stance, PB_STANCE.CROUCH);
  for (let i = 0; i < 5; i++) stepRunner(s, 0, 0, BTN.Y, DT, open);
  assert.equal(s.stance, PB_STANCE.PRONE, 'one step per press: holding the key does not keep cycling');
  stepRunner(s, 0, 0, 0, DT, open);
  tap(s, open, BTN.Y);
  assert.equal(s.stance, PB_STANCE.STAND);
  tap(s, open, BTN.R);
  assert.equal(s.stance, PB_STANCE.CROUCH);
  tap(s, open, BTN.R);
  assert.equal(s.stance, PB_STANCE.STAND);
  tap(s, open, BTN.L);
  assert.equal(s.stance, PB_STANCE.PRONE);
  stepRunner(s, 0, 0, BTN.X, DT, open);
  assert.equal(s.stance, PB_STANCE.STAND, 'jump gets you up …');
  assert.equal(s.z, 0, '… without jumping yet');
  stepRunner(s, 0, 0, BTN.X, DT, open);
  assert.ok(s.z > 0, 'still holding it: now you jump');
});

test('crouching and lying down make you slower and lower; you only get up where there is room', () => {
  const dist = (buttons) => {
    const s = createRunner(20, 150, 0);
    tap(s, open, buttons);
    walk(s, open, 1, 0, 45);
    return s.x - 20;
  };
  const stand = dist(0);
  const crouch = dist(BTN.R);
  const prone = dist(BTN.L);
  assert.ok(crouch < stand * 0.65 && crouch > stand * 0.45, `crouching ${crouch.toFixed(1)} vs ${stand.toFixed(1)}`);
  assert.ok(prone < stand * 0.4, `lying ${prone.toFixed(1)}`);
  // A table 13 high (crawl under it crouching) and a bench 7 high (only lying down).
  const level = { key: 'crawl', width: 300, height: 300, solids: [
    { t: 'box', x: 100, y: 100, w: 30, h: 30, z0: 13, z1: 14.5 },
    { t: 'box', x: 200, y: 100, w: 30, h: 30, z0: 7, z1: 8 },
  ] };
  const a = walk(createRunner(60, 100, 0), level, 1, 0, 60);
  assert.ok(a.x < 85 - PB_PHYS.RADIUS + 0.01, 'standing you bump into the table');
  const b = createRunner(60, 100, 0);
  tap(b, level, BTN.R);
  walk(b, level, 1, 0, 50);
  assert.ok(Math.abs(b.x - 100) < 12, `crouching you get under it (${b.x.toFixed(1)})`);
  walk(b, level, 0, 0, 3);
  tap(b, level, BTN.R);
  assert.equal(b.stance, PB_STANCE.CROUCH, 'no room to stand up under the table');
  const c = createRunner(160, 100, 0);
  tap(c, level, BTN.R);
  walk(c, level, 1, 0, 50);
  assert.ok(c.x < 185 - PB_PHYS.RADIUS + 0.01, 'crouching you bump into the bench');
  const d = createRunner(160, 100, 0);
  tap(d, level, BTN.L);
  for (let i = 0; i < 200 && d.x < 200; i++) stepRunner(d, 1, 0, 0, DT, level);
  assert.ok(d.x >= 200, `lying down you crawl under it (${d.x.toFixed(1)})`);
  walk(d, level, 0, 0, 10);
  tap(d, level, BTN.Y);
  assert.equal(d.stance, PB_STANCE.PRONE, 'no room to get up under the bench');
  walk(d, level, 1, 0, 120);
  tap(d, level, BTN.L);
  assert.equal(d.stance, PB_STANCE.STAND, 'out in the open you stand up again');
});

test('a crouching player is smaller: a level shot over their head misses, one aimed lower hits', () => {
  const room = fakeRoom([human('p1', 0), human('p2', 1)]);
  const game = paintball.create(room, { arena: 'opblaas', duration: 60 });
  run(game, room, 3.2);
  const ea = game.ent('p1');
  const eb = game.ent('p2');
  ea.s.x = 20; ea.s.y = 12; eb.s.x = 100; eb.s.y = 12;
  ea.shield = eb.shield = 0;
  eb.s.stance = PB_STANCE.CROUCH;
  run(game, room, 0.1);
  eb.shield = 0;
  ea.cooldown = 0;
  assert.equal(game.shoot(ea, 0, 0, room.now(), null), null, 'over the head of a crouching player');
  ea.cooldown = 0;
  assert.equal(game.shoot(ea, 0, Math.atan2(7 - PB_PHYS.EYE, 80), room.now(), null), eb, 'aimed at the body: a hit');
  ea.s.stance = PB_STANCE.PRONE;
  ea.cooldown = 0;
  game.shoot(ea, 0, 0, room.now(), null);
  const shot = room.events.filter((e) => e.e === 'shot').at(-1);
  assert.ok(shot.z0 < 6, `lying down you shoot from low (${shot.z0})`);
});

test('bots duck while they reload and stand up again', () => {
  const room = fakeRoom([bot('p1', 0, 'normal')]);
  const game = paintball.create(room, { arena: 'bouw', duration: 60, powerups: false });
  run(game, room, 3.5);
  const e = game.ents[0];
  e.ammo = 0;
  e.reload = PB_RULES.RELOAD_S;
  run(game, room, 0.3);
  assert.equal(e.s.stance, PB_STANCE.CROUCH, 'ducked');
  run(game, room, PB_RULES.RELOAD_S + 0.5);
  assert.equal(e.s.stance, PB_STANCE.STAND, 'up again');
});

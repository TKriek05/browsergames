// Tank Tumult: deterministic physics, bullets, crates, bots and rounds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import tanks from '../server/games/tanks.js';
import { stepTank, createTankState, isSolid, TANK_PHYS } from '../shared/physics/tanks.js';
import { TANK_ARENAS, TANK_TILE, TANK_COLS, TILE } from '../shared/maps/tank-arenas.js';
import { TANK_PHASE, TANK_RULES } from '../shared/games/tanks.js';
import { findPath, lineOfSight } from '../server/games/tanks-bots.js';
import { ByteWriter, ByteReader, quantizeAxis } from '../shared/binary.js';
import { createRng } from '../shared/rng.js';
import { SIM_TICK_RATE } from '../shared/constants.js';

const DT = 1 / SIM_TICK_RATE;
const arena = TANK_ARENAS.kruispunt;

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

test('tank physics is deterministic and float32-exact', () => {
  const rng = createRng(7);
  const inputs = Array.from({ length: 600 }, () => [quantizeAxis(rng() * 2 - 1), quantizeAxis(rng() * 2 - 1)]);
  const runOnce = () => {
    const s = createTankState(arena.spawns[0].x, arena.spawns[0].y);
    for (const [ax, ay] of inputs) stepTank(s, ax, ay, TANK_PHYS.DT, arena.tiles);
    return s;
  };
  const a = runOnce();
  const b = runOnce();
  assert.deepEqual(a, b);
  for (const k of ['x', 'y', 'dx', 'dy', 'v']) assert.equal(a[k], Math.fround(a[k]), k);
  assert.ok(Math.abs(Math.hypot(a.dx, a.dy) - 1) < 1e-5, 'heading stays a unit vector');
});

test('tanks turn towards the stick, reverse when pulled back and never enter walls', () => {
  const s = createTankState(100, 100); // facing +x
  for (let i = 0; i < 30; i++) stepTank(s, 1, 0, TANK_PHYS.DT, arena.tiles);
  assert.ok(s.v > 50 && s.x > 120, 'drives forward');
  for (let i = 0; i < 20; i++) stepTank(s, -1, 0, TANK_PHYS.DT, arena.tiles);
  assert.ok(s.v < 0, 'pulling back reverses');
  assert.ok(s.dx > 0.99, 'still facing forward while reversing');
  const t = createTankState(40, 40);
  for (let i = 0; i < 200; i++) stepTank(t, -1, -1, TANK_PHYS.DT, arena.tiles);
  const tx = Math.floor(t.x / TANK_TILE);
  const ty = Math.floor(t.y / TANK_TILE);
  assert.equal(isSolid(arena.tiles, tx, ty), false, 'stopped by the corner walls');
  assert.ok(t.x >= TANK_TILE + TANK_PHYS.RADIUS - 0.01 && t.y >= TANK_TILE + TANK_PHYS.RADIUS - 0.01);
});

test('pathfinding goes around walls; line of sight is blocked by them', () => {
  const tiles = arena.tiles;
  const from = 1 * TANK_COLS + 1;
  const to = 18 * TANK_COLS + 30;
  const path = findPath(tiles, from, to);
  assert.equal(path.at(-1), to);
  for (const i of path) assert.notEqual(tiles[i], TILE.WALL);
  assert.equal(lineOfSight(tiles, 24, 24, 24, 300), true, 'open left column');
  assert.equal(lineOfSight(tiles, 24, 24, 24 + 32 * 16, 24), false, 'outer wall');
});

test('bullets bounce off walls, break crates and hurt tanks', () => {
  const a = human('p1', 0);
  const b = human('p2', 1);
  const room = fakeRoom([a, b]);
  const game = tanks.create(room, { mode: 'deathmatch', duration: 120, arena: 'kruispunt', seed: 1 });
  run(game, room, 3.1);
  assert.equal(game.phase, TANK_PHASE.PLAY);
  const [ta, tb] = game.tanks;
  // A shoots straight up at the outer wall from x = 40: the bullet bounces back down.
  Object.assign(ta.s, { x: 40, y: 60, v: 0 });
  Object.assign(tb.s, { x: 400, y: 200, v: 0 });
  ta.aim = -Math.PI / 2;
  ta.shield = 0;
  ta.cooldown = 0;
  game._fire(ta);
  run(game, room, 1.2);
  assert.ok(room.events.some((e) => e.e === 'bounce'), 'bounced');
  assert.ok(ta.hp < TANK_RULES.HP, 'own bullet came back and hit (after the bounce)');

  // Crate at tile (3,4) of kruispunt, straight above the tank: two hits break it.
  const crateTile = 4 * TANK_COLS + 3;
  assert.equal(game.tiles[crateTile], TILE.CRATE);
  Object.assign(ta.s, { x: 3.5 * TANK_TILE, y: 6 * TANK_TILE });
  for (let i = 0; i < 2; i++) {
    ta.cooldown = 0;
    ta.aim = -Math.PI / 2;
    game._fire(ta);
    run(game, room, 0.6);
  }
  assert.equal(game.tiles[crateTile], TILE.FLOOR, 'crate destroyed');
  assert.ok(room.events.some((e) => e.e === 'crate'));
});

test('a bot deathmatch runs to the end and bots score kills', () => {
  const players = [bot('p1', 0, 'hard'), bot('p2', 1), bot('p3', 2, 'easy'), bot('p4', 3, 'hard')];
  const room = fakeRoom(players);
  const game = tanks.create(room, { mode: 'deathmatch', duration: 120, arena: 'kruispunt', seed: 5 });
  run(game, room, 130);
  assert.ok(room.results, 'ended');
  assert.equal(room.results.rows.length, 4);
  const kills = room.results.rows.map((r) => Number(r.values[0]));
  assert.ok(kills.reduce((x, y) => x + Math.max(0, y), 0) >= 3, `bots fight (${kills})`);
  assert.deepEqual([...kills].sort((x, y) => y - x), kills);
});

test('rounds mode: first to three round wins', () => {
  const players = [bot('p1', 0, 'hard'), bot('p2', 1, 'hard'), bot('p3', 2, 'hard')];
  const room = fakeRoom(players);
  const game = tanks.create(room, { mode: 'rounds', duration: 120, arena: 'fort', seed: 9 });
  run(game, room, 600);
  assert.ok(room.results, 'ended');
  assert.equal(Number(room.results.rows[0].values[0]), TANK_RULES.ROUNDS_TO_WIN);
  assert.ok(room.events.filter((e) => e.e === 'round').length >= 3);
});

test('snapshot encoding has the documented layout', () => {
  const room = fakeRoom([bot('p1', 0), human('p2', 3)]);
  const game = tanks.create(room, { mode: 'deathmatch', duration: 120, arena: 'doolhof', seed: 2 });
  run(game, room, 4);
  const w = new ByteWriter();
  game.snapshot(w);
  const r = new ByteReader(w.toBytes());
  assert.equal(r.u8(), TANK_PHASE.PLAY);
  assert.equal(r.u8(), 0);
  r.f32();
  assert.equal(r.u8(), 1);
  assert.equal(r.u8(), 2);
  r.pos += 2 * 37; // two tank records
  const bullets = r.u8();
  r.pos += bullets * 7;
  assert.equal(r.u8(), TANK_ARENAS.doolhof.crates.length);
  r.pos += TANK_ARENAS.doolhof.crates.length;
  const pickups = r.u8();
  assert.equal(r.remaining, pickups * 5);
});

// Boemstad: arena, movement, explosions, items, bots, snapshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import bomber from '../server/games/bomber.js';
import { BOMB_COLS, BOMB_ROWS, BT, SPAWNS, buildArena, stepWalker, centre, tileIndex, spiralOrder } from '../shared/games/bomber.js';
import { ARCADE_PHASE } from '../shared/games/arcade.js';
import { BTN } from '../shared/messages.js';
import { ByteWriter, ByteReader } from '../shared/binary.js';
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
  for (let i = 0; i < seconds * SIM_TICK_RATE && !room.results; i++) game.tick(DT);
}

test('arena: walls around, pillars, free spawn corners, spiral covers the inside', () => {
  const tiles = buildArena(createRng(1));
  for (let x = 0; x < BOMB_COLS; x++) assert.equal(tiles[x], BT.WALL);
  assert.equal(tiles[tileIndex(2, 2)], BT.WALL, 'pillar');
  for (const [x, y] of SPAWNS) {
    assert.equal(tiles[tileIndex(x, y)], BT.FLOOR);
    assert.equal(tiles[tileIndex(x + 1, y)] === BT.BLOCK, false);
  }
  const spiral = spiralOrder();
  assert.equal(new Set(spiral.map(([x, y]) => `${x},${y}`)).size, spiral.length);
});

test('walking: blocked by walls, slides around corners, deterministic', () => {
  const tiles = buildArena(createRng(2), 0);
  const bombs = new Uint8Array(BOMB_COLS * BOMB_ROWS);
  const s = { x: centre(1), y: centre(1), dir: 1, speed: 0 };
  for (let i = 0; i < 30; i++) stepWalker(s, -1, 0, DT, tiles, bombs);
  assert.ok(s.x >= 16 + 6.5 - 0.01, 'stopped by the border');
  // Slightly off the lane, moving down past a pillar: slide into the lane.
  const t = { x: centre(1) + 5, y: centre(1), dir: 1, speed: 0 };
  for (let i = 0; i < 20; i++) stepWalker(t, 0, 1, DT, tiles, bombs);
  assert.ok(t.y > centre(1) + 10, 'moved down');
  assert.ok(Math.abs(t.x - centre(1)) < 1, 'snapped to the lane');
  assert.equal(t.x, Math.fround(t.x));
});

test('a bomb blows up a house, reveals items and burns a player', () => {
  const a = human('p1', 0);
  const b = human('p2', 1);
  const room = fakeRoom([a, b]);
  const game = bomber.create(room, { wins: 2, seed: 3 });
  run(game, room, 3.05);
  assert.equal(game.phase, ARCADE_PHASE.PLAY);
  const ea = game.ents[0];
  // Clear the area, put a house two tiles right of player A with an item inside.
  const [sx, sy] = SPAWNS[0];
  const house = tileIndex(sx + 2, sy);
  game.tiles[house] = BT.BLOCK;
  game.hidden[house] = 1;
  game.onInput(a, { seq: 1, buttons: BTN.A, ax: 0, ay: 0, aim: 0 });
  run(game, room, 0.1);
  assert.equal(game.bombs.length, 1);
  run(game, room, 2.5);
  assert.ok(room.events.some((e) => e.e === 'boom'));
  assert.equal(game.tiles[house], BT.FLOOR, 'house destroyed');
  assert.equal(game.items[house], 1, 'item revealed');
  assert.equal(ea.alive, false, 'A stood still on the bomb');
});

test('bots play full rounds and one of them wins the match', () => {
  const room = fakeRoom([bot('p1', 0, 'hard'), bot('p2', 1, 'easy')]);
  const game = bomber.create(room, { wins: 2, seed: 4 });
  run(game, room, 400);
  assert.ok(room.results, 'ended');
  assert.equal(Number(room.results.rows[0].values[0]), 2);
});

test('snapshot encoding has the documented layout', () => {
  const room = fakeRoom([bot('p1', 0), human('p2', 3)]);
  const game = bomber.create(room, { wins: 2, seed: 5 });
  run(game, room, 4);
  const w = new ByteWriter();
  game.snapshot(w);
  const r = new ByteReader(w.toBytes());
  assert.equal(r.u8(), ARCADE_PHASE.PLAY);
  r.f32(); r.u8(); r.u8(); r.u8();
  assert.equal(r.u8(), 2);
  r.pos += 2 * 18 + Math.ceil((BOMB_COLS * BOMB_ROWS) / 4);
  const nb = r.u8();
  r.pos += nb * 3;
  const nf = r.u8();
  r.pos += nf * 2;
  const ni = r.u8();
  assert.equal(r.remaining, ni * 3);
});

// Knalkanon: terrain, craters, shell flight with wind, turns, damage,
// falling into the sea and bot matches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import artillery from '../server/games/artillery.js';
import { ART, WEAPONS, makeTerrain, carve, flyShell } from '../shared/games/artillery.js';
import { createRng } from '../shared/rng.js';

function fakeRoom(players) {
  const room = {
    events: [], results: null,
    gamePlayers: () => players,
    emit: (e, data) => room.events.push({ e, ...data }),
    endGame(results) { room.results = results; },
  };
  return room;
}
const human = (id, slot) => ({ id, slot, name: `Mens${slot}`, color: slot, isBot: false, connected: true });
const bot = (id, slot, level = 'normal') => ({ id, slot, name: `Bot${slot}`, color: slot, isBot: true, botLevel: level });
const runUntil = (game, until, seconds = 60) => {
  for (let i = 0; i < seconds * 10 && !until(); i++) game.tick(0.1);
};

test('terrain: a height per column within bounds; craters dig in', () => {
  const t = makeTerrain(createRng(2));
  assert.equal(t.length, ART.WIDTH);
  assert.ok(t.every((h) => Number.isInteger(h) && h >= 40 && h <= 300));
  const flat = new Array(ART.WIDTH).fill(100);
  carve(flat, 300, 100, 20);
  assert.equal(flat[300], 80, 'the centre is dug out by the radius');
  assert.equal(flat[330], 100, 'outside the crater nothing changes');
  assert.ok(flat[310] < 100 && flat[310] > 80);
  carve(flat, 500, 40, 20); // a buried blast: the ground above sinks in
  assert.equal(flat[500], 60);
});

test('shells: gravity, wind and hitting cannons or the ground', () => {
  const flat = new Array(ART.WIDTH).fill(50);
  const calm = flyShell(flat, 100, 60, 45, 50, 0);
  const windy = flyShell(flat, 100, 60, 45, 50, 40);
  assert.equal(calm.out, false);
  assert.ok(Math.abs(calm.y - 50) < 5, 'lands on the ground');
  assert.ok(windy.x > calm.x + 20, 'tail wind carries it further');
  const hit = flyShell(flat, 100, 60, 45, 50, 0, [{ id: 'x', x: Math.round(calm.x), y: 50 }]);
  assert.equal(hit.hit, 'x');
  const away = flyShell(flat, 100, 60, 30, 100, 0);
  assert.equal(away.out, true, 'flies off the side');
});

test('turns: only the current player may aim and fire; damage and craters after landing', () => {
  const a = human('p1', 0);
  const b = human('p2', 1);
  const room = fakeRoom([a, b]);
  const game = artillery.create(room, { seed: 4 });
  runUntil(game, () => game.phase === 'aim');
  const cur = game.current();
  const other = [...game.cannons.values()].find((c) => c !== cur);
  game.onInput(other.player, { type: 'fire', angle: 45, power: 50 });
  assert.equal(game.phase, 'aim', 'not your turn');
  // Put the other cannon right where a simple shot lands.
  game.terrain.fill(80);
  other.x = cur.x < 360 ? 600 : 120;
  other.y = 80;
  cur.y = 80;
  const dir = other.x > cur.x ? 1 : -1;
  const angle = dir > 0 ? 45 : 135;
  let power = 40;
  for (let p = 20; p <= 100; p += 0.5) {
    const res = flyShell(game.terrain, cur.x + dir * 7.8, cur.y + 7 + 7.8, angle, p, game.wind, [{ id: other.player.id, x: other.x, y: other.y }]);
    if (res.hit === other.player.id) { power = p; break; }
  }
  game.onInput(cur.player, { type: 'aim', angle, power });
  game.onInput(cur.player, { type: 'fire' });
  assert.equal(game.phase, 'flight');
  assert.ok(room.events.some((e) => e.e === 'shot' && e.paths.length === 1));
  const before = other.hp;
  runUntil(game, () => game.phase === 'settle');
  assert.ok(other.hp < before, `damage done (${before} → ${other.hp})`);
  assert.ok(game.terrain[Math.round(other.x)] < 80, 'a crater');
  runUntil(game, () => game.phase === 'aim');
  assert.equal(game.current(), other, 'next player');
});

test('driving costs fuel and cannot climb walls; the snapshot sends the terrain only when it changed', () => {
  const room = fakeRoom([human('p1', 0), human('p2', 1)]);
  const game = artillery.create(room, { seed: 1 });
  runUntil(game, () => game.phase === 'aim');
  const c = game.current();
  game.terrain.fill(100);
  c.y = 100;
  const x = c.x;
  game.onInput(c.player, { type: 'move', dir: 1 });
  assert.equal(c.x, x + ART.MOVE_STEP);
  assert.equal(c.fuel, ART.FUEL - ART.MOVE_STEP);
  for (let i = c.x + 1; i < c.x + 20; i++) game.terrain[i] = 140;
  game.onInput(c.player, { type: 'move', dir: 1 });
  assert.equal(c.x, x + ART.MOVE_STEP, 'too steep');
  const first = game.snapshot(c.player);
  assert.ok(Array.isArray(first.terrain));
  assert.equal(game.snapshot(c.player).terrain, undefined, 'unchanged: not sent again');
  game.onReconnect(c.player);
  assert.ok(Array.isArray(game.snapshot(c.player).terrain), 'after a reconnect it is sent again');
});

test('the sea is fatal; the last cannon wins the round', () => {
  const room = fakeRoom([human('p1', 0), human('p2', 1)]);
  const game = artillery.create(room, { seed: 3 });
  runUntil(game, () => game.phase === 'aim');
  const cur = game.current();
  const other = [...game.cannons.values()].find((c) => c !== cur);
  for (let dx = -40; dx <= 40; dx++) game.terrain[Math.max(0, Math.min(ART.WIDTH - 1, other.x + dx))] = 2;
  cur.power = 5;
  cur.angle = 90;
  game.onInput(cur.player, { type: 'fire' });
  runUntil(game, () => game.phase === 'roundEnd' || game.phase === 'end');
  assert.equal(other.alive, false);
  assert.ok(room.events.some((e) => e.e === 'roundEnd' && e.id === cur.player.id));
});

test('weapons have limited ammo', () => {
  const room = fakeRoom([human('p1', 0), human('p2', 1)]);
  const game = artillery.create(room, { seed: 8 });
  runUntil(game, () => game.phase === 'aim');
  const c = game.current();
  game.onInput(c.player, { type: 'weapon', weapon: 1 });
  assert.equal(c.weapon, 1);
  game.onInput(c.player, { type: 'fire', angle: 90, power: 30 });
  assert.equal(c.ammo[1], 0);
  assert.equal(WEAPONS[1].ammo, 1);
});

test('bot matches end with a winner', () => {
  for (const lineup of [['hard', 'easy'], ['normal', 'hard', 'easy', 'normal']]) {
    const players = lineup.map((l, i) => bot(`p${i}`, i, l));
    const room = fakeRoom(players);
    const game = artillery.create(room, { rounds: 1, seed: 6 });
    runUntil(game, () => room.results, 2000);
    assert.ok(room.results, `${lineup.length} bots finish`);
    assert.equal(room.results.rows.length, lineup.length);
  }
});

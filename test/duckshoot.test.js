// Kwek Kwek Knal: lag compensation, shot rules, rounds and bots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import duckshoot from '../server/games/duckshoot.js';
import { LagHistory, MAX_REWIND_MS } from '../server/lagcomp.js';
import { DUCK_PHASE, DUCK_STATE, AMMO, cursorToAxis, axisToCursor } from '../shared/games/duckshoot.js';
import { ByteWriter, ByteReader, quantizeAxis } from '../shared/binary.js';
import { SIM_TICK_RATE } from '../shared/constants.js';

const DT = 1 / SIM_TICK_RATE;

function fakeRoom(players) {
  const room = {
    clock: 1_000_000,
    events: [],
    results: null,
    gamePlayers: () => players,
    now: () => room.clock,
    emit: (e, data) => room.events.push({ e, ...data }),
    endGame(results) { room.results = results; },
  };
  return room;
}

const bot = (id, slot, level = 'normal') => ({ id, slot, name: `Bot${slot}`, color: slot, isBot: true, botLevel: level, connected: false });
const human = (id, slot) => ({ id, slot, name: `Mens${slot}`, color: slot, isBot: false, connected: true });

function run(game, room, seconds) {
  for (let i = 0; i < seconds * SIM_TICK_RATE && !room.results; i++) {
    room.clock += DT * 1000;
    game.tick(DT);
  }
}

// Skip the countdown and put one wild duck on a known straight path.
function setupDuck(game, room) {
  run(game, room, 3.1);
  assert.equal(game.phase, DUCK_PHASE.PLAY);
  game.plan = [];
  game.ducks.length = 0;
  game.history.clear();
  game.ducks.push({ id: 99, type: 0, state: DUCK_STATE.FLY, x: 100, y: 60, vx: 60, vy: 0, speed: 60, age: 0, turnT: 99, stateT: 0, hitBy: -1 });
}

test('LagHistory interpolates between frames and clamps the rewind', () => {
  const h = new LagHistory({ frames: 4, capacity: 4 });
  const out = { x: 0, y: 0 };
  h.begin(1000); h.add(7, 0, 0);
  h.begin(1100); h.add(7, 10, 20);
  assert.ok(h.positionAt(7, 1050, out));
  assert.deepEqual(out, { x: 5, y: 10 });
  assert.ok(h.positionAt(7, 5000, out), 'newer than history: newest frame');
  assert.deepEqual(out, { x: 10, y: 20 });
  assert.equal(h.positionAt(8, 1050, { x: 0, y: 0 }), false, 'unknown id');
  for (let t = 1200; t <= 1600; t += 100) { h.begin(t); h.add(7, t, 0); }
  assert.ok(h.positionAt(7, 0, out), 'older than history: oldest frame');
  assert.equal(out.x, 1300);
  assert.equal(h.clampTime(0, 10_000), 10_000 - MAX_REWIND_MS);
  assert.equal(h.clampTime(20_000, 10_000), 10_000);
  assert.equal(h.clampTime(NaN, 10_000), 10_000);
});

test('cursor positions survive the trip through the input axes', () => {
  for (const [x, y] of [[0, 0], [320, 180], [160.4, 90.2], [13, 170]]) {
    const [ax, ay] = cursorToAxis(x, y);
    const [bx, by] = axisToCursor(quantizeAxis(ax), quantizeAxis(ay));
    assert.ok(Math.abs(bx - x) < 1.4 && Math.abs(by - y) < 0.8, `${x},${y} → ${bx},${by}`);
  }
});

test('a shot is judged where the shooter saw the duck (lag compensation)', () => {
  const me = human('p1', 0);
  const room = fakeRoom([me]);
  const game = duckshoot.create(room, { mode: 'versus', rounds: 3, seed: 1 });
  setupDuck(game, room);
  run(game, room, 0.2);
  const seenAt = room.clock; // the duck is somewhere around x = 112 now
  const seen = game.ducks[0].x;
  run(game, room, 0.2); // 200 ms later the shot arrives; the duck moved on ~12 px

  assert.ok(game.ducks[0].x - seen > 10);
  game.onAction(me, { x: seen, y: 60, t: room.clock }); // "now", but at the old spot
  assert.equal(game.ducks[0].state, DUCK_STATE.FLY, 'no rewind: a miss');

  game.shooters[0].cooldown = 0;
  game.onAction(me, { x: seen, y: 60, t: seenAt });
  assert.equal(game.ducks[0].state, DUCK_STATE.HIT, 'rewound to the view time: a hit');
  assert.equal(game.shooters[0].score, 100);
  const shot = room.events.filter((e) => e.e === 'shot').at(-1);
  assert.deepEqual(shot.hits, [{ id: 99, p: 100 }]);
});

test('ammo, cooldown and reload are enforced by the server', () => {
  const me = human('p1', 0);
  const room = fakeRoom([me]);
  const game = duckshoot.create(room, { mode: 'versus', rounds: 3, seed: 2 });
  setupDuck(game, room);
  const s = game.shooters[0];
  game.onAction(me, { x: 5, y: 5, t: room.clock });
  game.onAction(me, { x: 5, y: 5, t: room.clock }); // within the cooldown
  assert.equal(s.shots, 1);
  for (let i = 0; i < 10; i++) {
    s.cooldown = 0;
    game.onAction(me, { x: 5, y: 5, t: room.clock });
  }
  assert.equal(s.shots, AMMO.MAGAZINE, 'no more shots than one magazine');
  assert.equal(s.ammo, 0);
  assert.ok(s.reload > 0, 'empty magazine reloads automatically');
  run(game, room, AMMO.RELOAD_S + 0.1);
  assert.equal(s.ammo, AMMO.MAGAZINE);
  game.onAction(me, { x: 'x', y: 5, t: 0 });
  game.onAction(me, { x: 999, y: 5, t: room.clock });
  assert.equal(s.shots, AMMO.MAGAZINE, 'invalid shots are ignored');
});

test('a bot-only versus game runs all rounds and ranks the players', () => {
  const players = [bot('p1', 0, 'hard'), bot('p2', 1, 'normal'), bot('p3', 2, 'easy')];
  const room = fakeRoom(players);
  const game = duckshoot.create(room, { mode: 'versus', rounds: 3, seed: 42 });
  run(game, room, 200);
  assert.ok(room.results, 'game ended');
  assert.equal(room.results.rows.length, 3);
  const scores = room.results.rows.map((r) => Number(r.values[0]));
  assert.deepEqual([...scores].sort((a, b) => b - a), scores);
  assert.ok(scores[0] > 0, 'bots hit ducks');
  assert.equal(room.events.filter((e) => e.e === 'round').length, 3);
});

test('co-op ends early when the team misses the quota', () => {
  const room = fakeRoom([human('p1', 0), human('p2', 1)]);
  const game = duckshoot.create(room, { mode: 'coop', rounds: 5, seed: 3 });
  run(game, room, 120);
  assert.ok(room.results);
  const roundEnd = room.events.find((e) => e.e === 'roundEnd');
  assert.equal(roundEnd.ok, false);
  assert.equal(room.events.filter((e) => e.e === 'round').length, 1, 'no second round');
  assert.match(room.results.title, /0 van 5 rondes/);
});

test('snapshot encoding has the documented layout', () => {
  const room = fakeRoom([bot('p1', 0), human('p2', 3)]);
  const game = duckshoot.create(room, { mode: 'coop', rounds: 3, seed: 4 });
  run(game, room, 5);
  const w = new ByteWriter();
  game.snapshot(w);
  const r = new ByteReader(w.toBytes());
  assert.equal(r.u8(), DUCK_PHASE.PLAY);
  assert.equal(r.u8(), 1, 'coop');
  assert.equal(r.u8(), 1, 'round');
  assert.equal(r.u8(), 3, 'rounds');
  r.f32(); r.u8(); r.u8(); r.u8(); r.i32();
  assert.equal(r.u8(), 2, 'shooters');
  r.pos += 2 * 16; // two shooter records
  const ducks = r.u8();
  assert.equal(ducks, game.ducks.length);
  assert.equal(r.remaining, ducks * 8);
});

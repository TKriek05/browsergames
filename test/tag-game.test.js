// The tag server module with a fake room: full game in fast-forward.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import tag, { PHASE } from '../server/games/tag.js';
import { ByteWriter, ByteReader } from '../shared/binary.js';
import { SIM_TICK_RATE } from '../shared/constants.js';
import { POWER, POWERS, POWER_TUNING, canTake } from '../shared/games/tag-powers.js';
import { stepRunner, TAG_PHYS } from '../shared/physics/tag.js';
import { orbSpots } from '../server/games/tag-powers.js';
import { TAG_ARENAS } from '../shared/maps/tag-arenas.js';

function fakeRoom(players) {
  const events = [];
  return {
    events,
    results: null,
    gamePlayers: () => players,
    now: () => 0,
    emit: (e, data) => events.push({ e, ...data }),
    endGame(results) { this.results = results; },
  };
}

const bot = (id, slot, level = 'normal') => ({ id, slot, name: `Bot${slot}`, color: slot, isBot: true, botLevel: level, connected: false });

test('a full bot-only game runs to the end with a ranking', () => {
  const players = [bot('p1', 0, 'hard'), bot('p2', 1), bot('p3', 2, 'easy'), bot('p4', 3)];
  const room = fakeRoom(players);
  const game = tag.create(room, { duration: 60, arena: 'pillars' });
  const dt = 1 / SIM_TICK_RATE;
  let ticks = 0;
  while (!room.results && ticks < 100 * SIM_TICK_RATE) {
    game.tick(dt);
    ticks++;
  }
  assert.ok(room.results, 'game ended');
  assert.equal(room.results.rows.length, 4);
  const times = room.results.rows.map((r) => parseFloat(r.values[0].replace(',', '.')));
  assert.deepEqual([...times].sort((a, b) => a - b), times, 'sorted by time as tagger');
  const total = times.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 60) < 1, `someone is always "it" (total ${total})`);
  assert.ok(room.events.some((e) => e.e === 'go'));
  assert.ok(room.events.some((e) => e.e === 'tag'), 'bots actually tag each other');
});

test('snapshot encoding has the documented layout', () => {
  const players = [bot('p1', 0), bot('p2', 4)];
  const game = tag.create(fakeRoom(players), { duration: 60, arena: 'open' });
  const w = new ByteWriter();
  game.snapshot(w);
  const r = new ByteReader(w.toBytes());
  assert.equal(r.u8(), PHASE.COUNTDOWN);
  assert.ok(r.f32() > 0);
  const itSlot = r.u8();
  assert.ok(itSlot === 0 || itSlot === 4);
  assert.equal(r.u8(), 2);
  assert.equal(r.u8(), 0, 'first runner slot');
  assert.equal(r.remaining, 34 + 35 + 1, 'rest of runner 1 + runner 2 + orb count');
});

test('humans are only moved by their queued inputs', () => {
  const human = { id: 'p1', slot: 0, name: 'Mens', color: 0, isBot: false, connected: true };
  const game = tag.create(fakeRoom([human, bot('p2', 1)]), { duration: 60, arena: 'open' });
  const dt = 1 / SIM_TICK_RATE;
  for (let i = 0; i < 3 * SIM_TICK_RATE + 1; i++) game.tick(dt); // countdown
  const runner = game.runners.find((r) => r.player === human);
  const x0 = runner.x;
  game.tick(dt);
  assert.equal(runner.x, x0, 'no input, no movement');
  for (let seq = 1; seq <= 10; seq++) game.onInput(human, { seq, buttons: 0, ax: 1, ay: 0, aim: 0 });
  for (let i = 0; i < 10; i++) game.tick(dt);
  assert.ok(runner.x > x0);
  assert.equal(runner.queue.ackSeq, 10);
});

// --- Power-ups ------------------------------------------------------------------------
const human = (id, slot) => ({ id, slot, name: `Mens${slot}`, color: slot, isBot: false, connected: true });
const dt = 1 / SIM_TICK_RATE;

// A game in PLAY with runner 0 as the tagger, everybody parked far apart.
function playing(n = 3, settings = {}) {
  const players = Array.from({ length: n }, (_, i) => human(`p${i + 1}`, i));
  const room = fakeRoom(players);
  const game = tag.create(room, { duration: 60, arena: 'open', ...settings });
  for (let i = 0; i < 3 * SIM_TICK_RATE + 1; i++) game.tick(dt);
  assert.equal(game.phase, PHASE.PLAY);
  game.itId = 'p1';
  game.runners.forEach((r, i) => Object.assign(r, { x: 30 + i * 120, y: 90, vx: 0, vy: 0, stun: 0, immune: 0 }));
  game.powers.orbs = [];
  game.powers.spawnIn = 99;
  return { game, room, runners: game.runners };
}

function place(game, power, x, y) {
  game.powers.orbs.push({ id: 9, power, x, y, life: 10 });
}

test('power-ups: who may take what', () => {
  const byId = (id) => POWERS[id];
  assert.equal(canTake(byId(POWER.TURBO), true), true);
  assert.equal(canTake(byId(POWER.TURBO), false), true);
  assert.equal(canTake(byId(POWER.REACH), true), true);
  assert.equal(canTake(byId(POWER.REACH), false), false);
  assert.equal(canTake(byId(POWER.SHIELD), true), false);
  assert.equal(canTake(byId(POWER.WARP), false), true);
  POWERS.forEach((p, i) => assert.equal(p.id, i, 'index = id (used on the wire)'));
});

test('turbo is faster and a freeze wave slower, in the shared physics', () => {
  const run = (extra) => {
    const s = { x: 10, y: 90, vx: 0, vy: 0, stun: 0, ...extra };
    for (let i = 0; i < 30; i++) stepRunner(s, 1, 0, dt, [], false);
    return s;
  };
  const normal = run({});
  const fast = run({ boost: 3 });
  const slow = run({ slow: 3 });
  assert.ok(fast.x > normal.x + 5, `turbo ${fast.x} > ${normal.x}`);
  assert.ok(slow.x < normal.x - 5, `slow ${slow.x} < ${normal.x}`);
  assert.ok(Math.abs(fast.boost - 2) < 1e-4, 'timer runs down');
  assert.ok(Math.hypot(fast.vx, fast.vy) <= TAG_PHYS.MAX_SPEED * TAG_PHYS.BOOST_SPEED + 1e-3);
});

test('orbs only go to the right role and start their effect', () => {
  const { game, room, runners } = playing();
  const [it, a] = runners;
  place(game, POWER.SHIELD, it.x, it.y); // a runner power under the tagger: stays
  game.tick(dt);
  assert.equal(game.powers.orbs.length, 1);
  assert.equal(it.shield, 0);
  game.powers.orbs = [];
  place(game, POWER.SHIELD, a.x, a.y);
  game.tick(dt);
  assert.equal(game.powers.orbs.length, 0);
  assert.ok(a.shield > 3.5);
  assert.ok(room.events.some((e) => e.e === 'power' && e.id === 'p2' && e.p === POWER.SHIELD));
  place(game, POWER.REACH, it.x, it.y);
  game.tick(dt);
  assert.ok(it.reach > 4.5);
});

test('a shield stops the tagger, long reach tags from further away', () => {
  const { game, runners } = playing(2);
  const [it, a] = runners;
  a.shield = 2;
  Object.assign(a, { x: it.x + 6, y: it.y });
  game.tick(dt);
  assert.equal(game.itId, 'p1', 'shielded: no tag');
  a.shield = 0;
  Object.assign(a, { x: it.x + TAG_PHYS.RADIUS * 2 + 5, y: it.y });
  game.tick(dt);
  assert.equal(game.itId, 'p1', 'just out of normal reach');
  it.reach = 2;
  game.tick(dt);
  assert.equal(game.itId, 'p2', 'long reach tags');
  assert.equal(it.reach, 0, 'the power ends with the tag');
});

test('a freeze wave slows runners nearby; warp jumps away from the tagger', () => {
  const { game, room, runners } = playing(3);
  const [it, near, far] = runners;
  Object.assign(near, { x: it.x + 40, y: it.y });
  Object.assign(far, { x: 300, y: 170 });
  near.boost = 2;
  place(game, POWER.FREEZE, it.x, it.y);
  game.tick(dt);
  assert.ok(near.slow > 2, 'near runner frozen');
  assert.equal(near.boost, 0, 'turbo ends');
  assert.equal(far.slow, 0, 'far runner untouched');
  assert.equal(it.slow, 0, 'not the tagger itself');

  Object.assign(near, { x: 300, y: 20 });
  Object.assign(far, { x: it.x + 30, y: it.y });
  place(game, POWER.WARP, far.x, far.y);
  const before = Math.hypot(far.x - it.x, far.y - it.y);
  game.tick(dt);
  const after = Math.hypot(far.x - it.x, far.y - it.y);
  assert.ok(after > before + 100, `warped away (${before.toFixed(0)} → ${after.toFixed(0)})`);
  assert.ok(room.events.some((e) => e.e === 'warp' && e.id === far.player.id));
});

test('orbs spawn on free spots, expire, and not at all when switched off', () => {
  for (const arena of Object.values(TAG_ARENAS)) {
    const spots = orbSpots(arena.walls);
    assert.ok(spots.length > 40);
    for (const s of spots) {
      for (const w of arena.walls) assert.ok(!(s.x >= w.x - 5 && s.x <= w.x + w.w + 5 && s.y >= w.y - 5 && s.y <= w.y + w.h + 5), 'not in a wall');
    }
  }
  const { game } = playing(3);
  game.powers.spawnIn = 0;
  game.tick(dt);
  assert.equal(game.powers.orbs.length, 1);
  for (let i = 0; i < (POWER_TUNING.ORB_LIFE_S + 1) * SIM_TICK_RATE && game.powers.orbs.length; i++) {
    game.powers.spawnIn = 99;
    game.runners.forEach((r) => { r.x = 5; r.y = 5; });
    game.tick(dt);
  }
  assert.equal(game.powers.orbs.length, 0, 'expired');

  const off = playing(3, { powerups: false });
  off.game.powers.spawnIn = 0;
  for (let i = 0; i < 20 * SIM_TICK_RATE; i++) off.game.tick(dt);
  assert.equal(off.game.powers.orbs.length, 0);
});

test('bots pick up power-ups during a full game', () => {
  const players = [bot('p1', 0, 'hard'), bot('p2', 1, 'hard'), bot('p3', 2, 'normal'), bot('p4', 3, 'hard')];
  const room = fakeRoom(players);
  const game = tag.create(room, { duration: 90, arena: 'pillars' });
  while (!room.results) game.tick(dt);
  const powers = room.events.filter((e) => e.e === 'power');
  assert.ok(powers.length >= 5, `bots used ${powers.length} power-ups`);
});

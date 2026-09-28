// Neon Kart GP: tracks, deterministic kart physics, laps, items and races.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import kartrace from '../server/games/kartrace.js';
import { stepKart, createKartState, KART_PHYS } from '../shared/physics/kart.js';
import { KART_TRACKS, KART_TRACK_IDS, trackQuery, pointAt, WALL_MARGIN } from '../shared/maps/kart-tracks.js';
import { KART_PHASE, ITEM } from '../shared/games/kartrace.js';
import { BTN } from '../shared/messages.js';
import { ByteWriter, ByteReader, quantizeAxis } from '../shared/binary.js';
import { createRng } from '../shared/rng.js';
import { SIM_TICK_RATE } from '../shared/constants.js';

const DT = 1 / SIM_TICK_RATE;
const ring = KART_TRACKS.ring;
const q = { seg: 0, dist: 0, lateral: 0, nx: 0, ny: 0 };

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
// Open field: the same track data without grass or barriers in reach.
const open = { ...ring, pads: [], half: 5000 };
function onStraight(d = 10) {
  const p = pointAt(ring, d); // Neon Ring starts with a long straight
  return Object.assign(createKartState(), { x: p.x, y: p.y, hx: p.tx, hy: p.ty });
}
function onGrid(slot = 0, track = ring) {
  const g = track.grid[slot];
  return Object.assign(createKartState(), { x: g.x, y: g.y, hx: g.hx, hy: g.hy });
}

test('every track is a clean loop: branches never overlap, grid and boxes are on the road', () => {
  for (const id of KART_TRACK_IDS) {
    const t = KART_TRACKS[id];
    const need = 2 * (t.half + WALL_MARGIN);
    for (let i = 0; i < t.count; i += 3) {
      for (let j = 0; j < t.count; j += 3) {
        const along = Math.abs(t.cum[i] - t.cum[j]);
        if (Math.min(along, t.length - along) < need * 2.2) continue;
        assert.ok(Math.hypot(t.px[i] - t.px[j], t.py[i] - t.py[j]) > need, `${id}: samples ${i}/${j} too close`);
      }
    }
    for (const p of [...t.grid, ...t.boxes, ...t.pads]) {
      trackQuery(t, p.x, p.y, q);
      assert.ok(Math.abs(q.lateral) < t.half, `${id}: object off the road`);
    }
    const p = pointAt(t, t.length * 0.5);
    trackQuery(t, p.x, p.y, q);
    assert.ok(Math.abs(q.dist - t.length * 0.5) < 1, 'pointAt and trackQuery agree');
  }
});

test('kart physics is deterministic and float32-exact', () => {
  const rng = createRng(11);
  const inputs = Array.from({ length: 900 }, () => [quantizeAxis(rng() * 2 - 1), quantizeAxis(rng() - 0.8), rng() < 0.9 ? BTN.A | (rng() < 0.3 ? BTN.B : 0) : 0]);
  const once = () => {
    const s = onGrid();
    for (const [ax, ay, b] of inputs) stepKart(s, ax, ay, b, DT, ring);
    return s;
  };
  const a = once();
  const b = once();
  delete a.fired; delete a.wall; delete b.fired; delete b.wall;
  assert.deepEqual(a, b);
  for (const k of ['x', 'y', 'hx', 'hy', 'v', 'vs', 'charge', 'boost']) assert.equal(a[k], Math.fround(a[k]), k);
});

test('gas accelerates, barriers hold the kart, grass slows it down', () => {
  const s = onStraight();
  for (let i = 0; i < 60; i++) stepKart(s, 0, 0, BTN.A, DT, ring);
  assert.ok(s.v > 120, `speed after 2 s: ${s.v}`);
  trackQuery(ring, s.x, s.y, q);
  assert.equal(s.off, 0, 'still on the road');
  // Steer hard right into the barrier for a few seconds.
  for (let i = 0; i < 150; i++) {
    stepKart(s, 1, 0, BTN.A, DT, ring);
    trackQuery(ring, s.x, s.y, q);
    assert.ok(Math.abs(q.lateral) <= ring.half + WALL_MARGIN - KART_PHYS.RADIUS + 0.01, 'never through the barrier');
  }
  const grass = onStraight(20);
  const p = pointAt(ring, 20);
  grass.x += -p.ty * (ring.half + 12); // on the grass beside the road
  grass.y += p.tx * (ring.half + 12);
  for (let i = 0; i < 90; i++) stepKart(grass, 0, 0, BTN.A, DT, { ...ring, pads: [] });
  assert.equal(grass.off, 1);
  assert.ok(grass.v <= KART_PHYS.OFFROAD_SPEED + 0.01, `grass limits the top speed (${grass.v})`);
});

test('a long drift gives a mini turbo; the turbo item boosts', () => {
  const s = onStraight();
  s.v = 150;
  for (let i = 0; i < 40; i++) stepKart(s, 0.6, 0, BTN.A | BTN.B, DT, open);
  assert.equal(s.drift, 1, 'drifting to the right');
  assert.ok(s.vs < 0, 'sliding outwards');
  stepKart(s, 0, 0, BTN.A, DT, open);
  assert.equal(s.drift, 0);
  assert.ok(s.boost > 0.5, `mini turbo (${s.boost})`);
  const t = onGrid();
  t.item = ITEM.TURBO;
  stepKart(t, 0, 0, BTN.A | BTN.X, DT, ring);
  assert.equal(t.item, 0);
  assert.ok(t.boost > 1);
});

test('laps need all checkpoints; reversing over the line does not count', () => {
  const room = fakeRoom([human('p1', 0), bot('p2', 1)]);
  const game = kartrace.create(room, { track: 'ring', laps: 2, items: false, seed: 1 });
  run(game, room, 4.1);
  assert.equal(game.phase, KART_PHASE.RACE);
  const k = game.karts[0];
  // Teleport just past the line: first crossing starts lap 1.
  const put = (d) => { const p = pointAt(ring, d); k.s.x = p.x; k.s.y = p.y; game._progress(k); };
  put(ring.length - 5);
  put(5);
  assert.equal(k.lap, 1);
  put(ring.length - 5); // back over the line
  assert.equal(k.lap, 0);
  put(5);
  put(ring.length * 0.9); // jump without checkpoints…
  put(10);
  assert.equal(k.lap, 1, '…is not a lap');
  for (const frac of [0.3, 0.6, 0.8, 0.95]) put(ring.length * frac);
  put(8);
  assert.equal(k.lap, 2);
});

test('an orb spins out the kart in front; a shield blocks it', () => {
  const a = human('p1', 0);
  const b = human('p2', 1);
  const room = fakeRoom([a, b]);
  const game = kartrace.create(room, { track: 'boulevard', laps: 3, items: true, seed: 2 });
  run(game, room, 4.1);
  const [ka, kb] = game.karts;
  const p = pointAt(KART_TRACKS.boulevard, 300);
  Object.assign(ka.s, { x: p.x, y: p.y, hx: p.tx, hy: p.ty });
  Object.assign(kb.s, { x: p.x + p.tx * 90, y: p.y + p.ty * 90, hx: p.tx, hy: p.ty });
  game._useItem(ka, ITEM.ORB);
  run(game, room, 0.6);
  assert.ok(kb.s.spin > 0 || room.events.some((e) => e.e === 'spin' && e.s === 1), 'spun out');
  kb.s.spin = 0;
  kb.shield = 5;
  Object.assign(kb.s, { x: p.x + p.tx * 90, y: p.y + p.ty * 90 });
  Object.assign(ka.s, { x: p.x, y: p.y });
  game._useItem(ka, ITEM.ORB);
  run(game, room, 0.6);
  assert.equal(kb.s.spin, 0, 'shield blocks');
  assert.ok(room.events.some((e) => e.e === 'block'));
});

test('a bot Grand Prix runs three races and ranks by points', () => {
  const players = [bot('p1', 0, 'hard'), bot('p2', 1, 'normal'), bot('p3', 2, 'easy')];
  const room = fakeRoom(players);
  const game = kartrace.create(room, { track: 'gp', laps: 2, items: true, seed: 8 });
  run(game, room, 600);
  assert.ok(room.results, 'ended');
  assert.equal(room.events.filter((e) => e.e === 'race').length, 3);
  const points = room.results.rows.map((r) => Number(r.values[0]));
  assert.deepEqual([...points].sort((x, y) => y - x), points);
  assert.ok(points[0] >= 20, `winner points ${points}`);
  assert.equal(room.results.rows[0].name, 'Bot0', 'the hard bot wins');
});

test('snapshot encoding has the documented layout', () => {
  const room = fakeRoom([bot('p1', 0), human('p2', 3)]);
  const game = kartrace.create(room, { track: 'park', laps: 3, items: true, seed: 5 });
  run(game, room, 6);
  const w = new ByteWriter();
  game.snapshot(w);
  const r = new ByteReader(w.toBytes());
  assert.equal(r.u8(), KART_PHASE.RACE);
  assert.equal(r.u8(), KART_TRACK_IDS.indexOf('park'));
  assert.equal(r.u8(), 1);
  assert.equal(r.u8(), 1);
  assert.equal(r.u8(), 3);
  r.f32(); r.f32();
  assert.equal(r.u8(), 2);
  r.pos += 2 * 52;
  r.u16();
  const objects = r.u8();
  assert.equal(r.remaining, objects * 7);
});

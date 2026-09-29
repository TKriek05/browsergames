// Turbo Kart GP: tracks, deterministic kart physics, laps, items and races.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import kartrace from '../server/games/kartrace.js';
import { stepKart, createKartState, KART_PHYS } from '../shared/physics/kart.js';
import { KART_TRACKS, KART_TRACK_IDS, KART_CUPS, trackQuery, createTrackQuery, pointAt, WALL_MARGIN, MAX_SLOPE } from '../shared/maps/kart-tracks.js';
import { KART_PHASE, KART_RULES, ITEM } from '../shared/games/kartrace.js';
import { BTN } from '../shared/messages.js';
import { ByteWriter, ByteReader, quantizeAxis } from '../shared/binary.js';
import { createRng } from '../shared/rng.js';
import { SIM_TICK_RATE } from '../shared/constants.js';

const DT = 1 / SIM_TICK_RATE;
const ring = KART_TRACKS.ring;
const q = createTrackQuery();

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
  const p = pointAt(ring, d); // Groene Vallei starts with a long straight
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
  game.items.use(ka, ITEM.ORB);
  run(game, room, 0.6);
  assert.ok(kb.s.spin > 0 || room.events.some((e) => e.e === 'spin' && e.s === 1), 'spun out');
  kb.s.spin = 0;
  kb.shield = 5;
  Object.assign(kb.s, { x: p.x + p.tx * 90, y: p.y + p.ty * 90 });
  Object.assign(ka.s, { x: p.x, y: p.y });
  game.items.use(ka, ITEM.ORB);
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
  assert.equal(r.remaining, objects * 8);
});

// --- Tracks with hills, barriers, oil and the new items ---------------------------------------
test('track rules: flat start, gentle slopes, no corner tighter than the barriers', () => {
  for (const id of KART_TRACK_IDS) {
    const t = KART_TRACKS[id];
    const lim = t.half + WALL_MARGIN;
    for (let i = 0; i < t.count; i++) {
      const frac = t.cum[i] / t.length;
      assert.ok(Math.abs(t.slope[i]) <= MAX_SLOPE, `${id}: slope ${t.slope[i]}`);
      if (frac < 0.05 || frac > 0.96) assert.equal(t.pz[i], 0, `${id}: the start straight is flat at 0`);
    }
    for (let d = 0; d < t.length; d += 5) {
      const a = pointAt(t, d);
      const b = pointAt(t, d + 30);
      const turn = Math.abs(Math.atan2(a.tx * b.ty - a.ty * b.tx, a.tx * b.tx + a.ty * b.ty));
      assert.ok(30 / Math.max(1e-6, turn) > lim + 3, `${id}: corner at ${(d / t.length).toFixed(2)} tighter than the barriers`);
    }
  }
  assert.equal(KART_TRACK_IDS.filter((id) => KART_TRACKS[id].hilly).length, 3, 'three tracks with hills');
  for (const cup of Object.values(KART_CUPS)) for (const id of cup) assert.ok(KART_TRACKS[id]);
});

test('hills: slower uphill, faster downhill (in the shared physics)', () => {
  const t = KART_TRACKS.alpine;
  let up = 0;
  let down = 0;
  for (let i = 0; i < t.count; i++) {
    if (t.slope[i] > t.slope[up]) up = i;
    if (t.slope[i] < t.slope[down]) down = i;
  }
  const topSpeed = (i, dir) => {
    const s = Object.assign(createKartState(), { x: t.px[i], y: t.py[i], hx: t.tx[i] * dir, hy: t.ty[i] * dir, v: KART_PHYS.MAX_SPEED });
    for (let k = 0; k < 20; k++) {
      stepKart(s, 0, 0, BTN.A, DT, { ...t, pads: [] });
      Object.assign(s, { x: t.px[i], y: t.py[i], hx: t.tx[i] * dir, hy: t.ty[i] * dir }); // stay on the slope
    }
    return s.v;
  };
  const flat = topSpeed(5, 1);
  assert.ok(topSpeed(up, 1) < flat - 15, `uphill ${topSpeed(up, 1)} vs flat ${flat}`);
  assert.ok(topSpeed(down, 1) > flat + 10, `downhill ${topSpeed(down, 1)} vs flat ${flat}`);
  assert.ok(Math.abs(flat - KART_PHYS.MAX_SPEED) < 1, 'flat road: the normal top speed');
});

test('barriers: a glancing hit slides along, a head-on hit costs speed and bounces', () => {
  const p = pointAt(ring, 60);
  const lim = ring.half + WALL_MARGIN - KART_PHYS.RADIUS;
  const nx = -p.ty;
  const ny = p.tx;
  // Glancing: 15° into the right-hand barrier, right next to it.
  const a = Math.PI / 12;
  const g = Object.assign(createKartState(), { x: p.x + nx * (lim - 1), y: p.y + ny * (lim - 1), v: 160,
    hx: p.tx * Math.cos(a) + nx * Math.sin(a), hy: p.ty * Math.cos(a) + ny * Math.sin(a) });
  stepKart(g, 0, 0, BTN.A, DT, ring); // (the grass in front of the barrier slows you down afterwards)
  assert.equal(g.wall, 1);
  assert.ok(g.v > 155, `glancing keeps its speed (${g.v})`);
  assert.ok(g.hx * p.tx + g.hy * p.ty > 0.99, 'turned along the barrier');
  // Head-on.
  const h = Object.assign(createKartState(), { x: p.x + nx * (lim - 2), y: p.y + ny * (lim - 2), v: 160, hx: nx, hy: ny });
  stepKart(h, 0, 0, BTN.A, DT, ring);
  assert.ok(h.v < 0, `bounced back (${h.v})`);
  assert.equal(h.wall, 1);
});

function race(track, players, extra = {}) {
  const room = fakeRoom(players);
  const game = kartrace.create(room, { track, laps: 3, items: true, seed: 3, ...extra });
  run(game, room, 4.1);
  assert.equal(game.phase, KART_PHASE.RACE);
  return { room, game };
}
const place = (k, track, d, lat = 0, v = 0) => {
  const p = pointAt(track, d);
  Object.assign(k.s, { x: p.x - p.ty * lat, y: p.y + p.tx * lat, hx: p.tx, hy: p.ty, v, spin: 0, boost: 0 });
  k.px = k.s.x;
  k.py = k.s.y;
};

test('oil: never spins the one who dropped it, always catches a fast kart driving over it', () => {
  const a = human('p1', 0);
  const b = human('p2', 1);
  const { game, room } = race('ring', [a, b]);
  const [ka, kb] = game.karts;
  place(ka, ring, 400);
  place(kb, ring, 100, 0);
  game.items.use(ka, ITEM.OIL); // standing still, the slick lands right behind
  run(game, room, 1);
  assert.equal(ka.s.spin, 0, 'no spin on your own oil');
  assert.equal(game.items.objects.length, 1);
  // A kart at full boost speed, with three inputs arriving in one tick (it jumps ~24 units).
  const oil = game.items.objects[0];
  trackQuery(ring, oil.x, oil.y, q);
  place(kb, ring, q.dist - 30, q.lateral, KART_PHYS.BOOST_SPEED);
  for (let seq = 1; seq <= 3; seq++) game.onInput(b, { seq, ax: 0, ay: 0, buttons: BTN.A, aim: 0 });
  run(game, room, DT);
  run(game, room, 0.2);
  assert.ok(kb.s.spin > 0, 'hit, even when it drove over it in one tick');
  assert.equal(game.items.objects.length, 0, 'the slick is used up');
});

test('bumping never pushes a kart through a barrier', () => {
  const { game, room } = race('ring', [bot('p1', 0), bot('p2', 1)]);
  const [ka, kb] = game.karts;
  const lim = ring.half + WALL_MARGIN - KART_PHYS.RADIUS;
  place(ka, ring, 500, lim - 1);
  place(kb, ring, 500, lim - 9);
  game._bumps();
  for (const k of [ka, kb]) {
    trackQuery(ring, k.s.x, k.s.y, q);
    assert.ok(Math.abs(q.lateral) <= lim + 0.01, `inside the barrier (${q.lateral})`);
  }
  void room;
});

test('turbo ×3 works three times', () => {
  const s = onGrid();
  s.item = ITEM.TURBO3;
  for (const left of [ITEM.TURBO2, ITEM.TURBO, 0]) {
    stepKart(s, 0, 0, BTN.A | BTN.X, DT, ring);
    assert.equal(s.item, left);
    assert.ok(s.boost > 1);
    stepKart(s, 0, 0, BTN.A, DT, ring); // release X
  }
});

test('rocket: homes in on the kart one place ahead, around the bends', () => {
  const players = [human('p1', 0), human('p2', 1), human('p3', 2)];
  const { game, room } = race('park', players);
  const t = KART_TRACKS.park;
  const [k1, k2, k3] = game.karts;
  place(k1, t, 900, 0);
  place(k2, t, 1500, -20); // one place ahead of k1, far around the track
  place(k3, t, 2600, 0);
  for (const k of game.karts) game._progress(k);
  game._rank();
  assert.equal(k1.place, 3);
  game.items.use(k1, ITEM.ROCKET);
  assert.equal(game.items.objects[0].target, k2);
  for (let i = 0; i < 6 * SIM_TICK_RATE && k2.s.spin === 0; i++) {
    place(k1, t, 900);
    place(k2, t, 1500, -20);
    run(game, room, DT);
  }
  assert.ok(room.events.some((e) => e.e === 'spin' && e.s === 1 && e.item === ITEM.ROCKET), 'the rocket found its target');
  assert.equal(k3.s.spin, 0);
});

test('lightning spins everybody else, a shield blocks it; the superstar spins who it bumps', () => {
  const players = [human('p1', 0), human('p2', 1), human('p3', 2)];
  const { game, room } = race('ring', players);
  const [k1, k2, k3] = game.karts;
  place(k1, ring, 300);
  place(k2, ring, 700);
  place(k3, ring, 1100);
  k3.shield = 3;
  game.items.use(k1, ITEM.LIGHTNING);
  assert.equal(k1.s.spin, 0);
  assert.ok(k2.s.spin > 0);
  assert.equal(k3.s.spin, 0, 'shielded');
  assert.ok(room.events.some((e) => e.e === 'zap'));
  // Superstar: a boost (predicted in the physics) and untouchable.
  k2.s.spin = 0;
  k1.s.item = ITEM.STAR;
  game.onInput(players[0], { seq: 1, ax: 0, ay: 0, buttons: BTN.X, aim: 0 });
  run(game, room, DT);
  assert.ok(k1.star > 4 && k1.s.boost > 4);
  place(k2, ring, 300, 3);
  place(k1, ring, 300, -3);
  game._bumps();
  assert.ok(k2.s.spin > 0, 'bumped by a star');
  assert.equal(k1.s.spin, 0);
});

test('bomb: thrown ahead, spins everybody near where it lands', () => {
  const players = [human('p1', 0), human('p2', 1), human('p3', 2)];
  const { game, room } = race('ring', players);
  const [k1, k2, k3] = game.karts;
  place(k1, ring, 300, 0, 0);
  const flight = KART_RULES.BOMB_SPEED * KART_RULES.BOMB_FLIGHT_S;
  place(k2, ring, 300 + KART_PHYS.RADIUS + 8 + flight, 10);
  place(k3, ring, 300 + flight + 200);
  game.items.use(k1, ITEM.BOMB);
  run(game, room, KART_RULES.BOMB_FLIGHT_S + 0.1);
  assert.ok(room.events.some((e) => e.e === 'boom'));
  assert.ok(k2.s.spin > 0, 'caught in the blast');
  assert.equal(k3.s.spin, 0, 'too far away');
  assert.equal(k1.s.spin, 0);
});

test('item roll: the leader never gets a rocket, lightning or superstar', () => {
  const { game } = race('ring', [human('p1', 0), bot('p2', 1), bot('p3', 2), bot('p4', 3)]);
  const [k1, , , k4] = game.karts;
  k1.place = 1;
  k4.place = 4;
  const lead = new Set();
  const last = new Set();
  for (let i = 0; i < 400; i++) {
    lead.add(game.items.roll(k1));
    last.add(game.items.roll(k4));
  }
  for (const item of [ITEM.ROCKET, ITEM.LIGHTNING, ITEM.STAR]) assert.ok(!lead.has(item));
  for (const item of [ITEM.ROCKET, ITEM.STAR, ITEM.TURBO3]) assert.ok(last.has(item), `last place can get ${item}`);
});

test('bots race a hilly Grand Prix with all the items', () => {
  const players = [bot('p1', 0, 'hard'), bot('p2', 1, 'normal'), bot('p3', 2, 'easy'), bot('p4', 3, 'normal')];
  const room = fakeRoom(players);
  const game = kartrace.create(room, { track: 'gphills', laps: 1, items: true, seed: 12 });
  run(game, room, 500);
  assert.ok(room.results, 'ended');
  const races = room.events.filter((e) => e.e === 'race').map((e) => e.track);
  assert.deepEqual(races, KART_CUPS.gphills);
  const used = new Set(room.events.filter((e) => e.e === 'use').map((e) => e.item));
  assert.ok(used.size >= 4, `bots used ${[...used]}`);
  // Bot-only races end shortly after the winner (nobody to wait for): one finish per race at least.
  const finishes = room.events.filter((e) => e.e === 'finish').length;
  assert.ok(finishes >= 3, `bots finish the races (${finishes})`);
  assert.ok(game.karts.every((k) => k.history.length === 3), 'everybody raced all three');
});

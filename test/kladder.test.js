// Kladderkoning: deterministic rolling, painting along the path, dash hits,
// the grid reaching the clients (recent changes + strips), power-ups, the maps
// and complete bot matches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import kladder, { STRIPS } from '../server/games/kladder.js';
import {
  KL, KL_W, KL_H, KL_CELLS, KL_MAPS, KL_SPAWNS, KL_POWER, KL_POWERS,
  createPainter, stepPainter, mapWalls, blockedCells, forCellsInDisc, collideWalls,
} from '../shared/games/kladder.js';
import { ARCADE_PHASE } from '../shared/games/arcade.js';
import { BTN } from '../shared/messages.js';
import { ByteWriter, ByteReader, quantizeAxis } from '../shared/binary.js';
import { createRng } from '../shared/rng.js';

const DT = KL.DT;
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
const tick = (game, room) => {
  room.clock += DT * 1000;
  game.tick(DT);
};
const run = (game, room, seconds) => {
  for (let i = 0; i < seconds * 30 && !room.results; i++) tick(game, room);
};

test('rolling is deterministic, float32-exact and stays out of the blocks', () => {
  const walls = mapWalls(KL_MAPS.doolhof);
  const rng = createRng(3);
  const inputs = Array.from({ length: 900 }, () => [quantizeAxis(rng() * 2 - 1), quantizeAxis(rng() * 2 - 1), rng() < 0.04 ? 1 : 0]);
  const once = () => {
    const s = createPainter(24, 24);
    for (const [ax, ay, a] of inputs) {
      stepPainter(s, ax, ay, a, DT, walls);
      for (const o of walls) {
        const inside = Math.abs(s.x - o.x) < o.w / 2 + KL.RADIUS - 0.01 && Math.abs(s.y - o.y) < o.h / 2 + KL.RADIUS - 0.01;
        const cx = Math.max(o.x - o.w / 2, Math.min(o.x + o.w / 2, s.x));
        const cy = Math.max(o.y - o.h / 2, Math.min(o.y + o.h / 2, s.y));
        assert.ok(!inside || Math.hypot(s.x - cx, s.y - cy) >= KL.RADIUS - 0.01, 'not inside a block');
      }
      assert.ok(s.x >= KL.RADIUS - 1e-3 && s.x <= KL_W - KL.RADIUS + 1e-3 && s.y >= KL.RADIUS - 1e-3 && s.y <= KL_H - KL.RADIUS + 1e-3);
    }
    return s;
  };
  const a = once();
  assert.deepEqual(a, once());
  for (const k of ['x', 'y', 'vx', 'vy', 'fx', 'fy', 'dash', 'cool', 'boost', 'stun']) assert.equal(a[k], Math.fround(a[k]), k);
});

test('a dash is fast, has a cooldown; turbo is faster; stunned means no control', () => {
  const s = createPainter(100, 160);
  for (let i = 0; i < 20; i++) stepPainter(s, 1, 0, 0, DT, []);
  const cruise = s.vx;
  assert.ok(Math.abs(cruise - KL.SPEED) < 1);
  stepPainter(s, 1, 0, 1, DT, []);
  assert.ok(s.vx > cruise * 2, 'dash');
  stepPainter(s, 1, 0, 0, DT, []);
  stepPainter(s, 1, 0, 1, DT, []);
  assert.ok(s.cool > KL.DASH_COOLDOWN_S - 0.2, 'no second dash during the cooldown');
  const t = createPainter(100, 160);
  t.boost = 3;
  for (let i = 0; i < 20; i++) stepPainter(t, 1, 0, 0, DT, []);
  assert.ok(t.vx > cruise * 1.3);
  const st = createPainter(100, 160);
  st.stun = 0.5;
  st.vx = 100;
  stepPainter(st, -1, 0, 1, DT, []);
  assert.ok(st.vx > 80 && st.dash === 0, 'slides on, can not dash');
});

test('every map: spawns free, every free cell reachable', () => {
  for (const [id, map] of Object.entries(KL_MAPS)) {
    const walls = mapWalls(map);
    const blocked = blockedCells(map);
    for (const sp of KL_SPAWNS) {
      const probe = { x: sp.x, y: sp.y };
      collideWalls(probe, walls, KL.RADIUS);
      assert.ok(probe.x === sp.x && probe.y === sp.y, `${id}: spawn ${sp.x},${sp.y} free`);
    }
    const seen = new Uint8Array(KL_CELLS);
    const start = Math.floor(KL_SPAWNS[0].y / KL.CELL) * KL.COLS + Math.floor(KL_SPAWNS[0].x / KL.CELL);
    const queue = [start];
    seen[start] = 1;
    while (queue.length) {
      const i = queue.pop();
      const c = i % KL.COLS;
      const r = (i - c) / KL.COLS;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= KL.COLS || nr >= KL.ROWS) continue;
        const ni = nr * KL.COLS + nc;
        if (seen[ni] || blocked[ni]) continue;
        seen[ni] = 1;
        queue.push(ni);
      }
    }
    for (let i = 0; i < KL_CELLS; i++) if (!blocked[i]) assert.ok(seen[i], `${id}: cell ${i} reachable`);
  }
});

function match(players, settings = {}) {
  const room = fakeRoom(players);
  const game = kladder.create(room, { duration: 60, seed: 4, map: 'open', ...settings });
  run(game, room, 3.1);
  assert.equal(game.phase, ARCADE_PHASE.PLAY);
  return { room, game };
}

test('rolling paints the path, counts add up, blocks stay blank', () => {
  const players = [human('p1', 0), human('p2', 1)];
  const { room, game } = match(players, { map: 'atelier', powerups: false });
  const a = game.ent('p1');
  let seq = 0;
  for (let i = 0; i < 90; i++) {
    game.onInput(players[0], { seq: ++seq, ax: 1, ay: 0.3, buttons: i === 40 ? BTN.A : 0, aim: 0 });
    tick(game, room);
  }
  assert.ok(game.cellsOf(a) > 60, `painted ${game.cellsOf(a)}`);
  let own = 0;
  for (let i = 0; i < KL_CELLS; i++) {
    if (game.grid[i] === 1) own++;
    if (game.blocked[i]) assert.equal(game.grid[i], 0, 'blocks are never painted');
  }
  assert.equal(own, game.cellsOf(a));
  // The cell under the painter is painted.
  const here = Math.floor(a.s.y / KL.CELL) * KL.COLS + Math.floor(a.s.x / KL.CELL);
  assert.equal(game.grid[here], 1);
});

test('a dash into someone stuns them and splashes your paint around them', () => {
  const players = [human('p1', 0), human('p2', 1)];
  const { room, game } = match(players, { powerups: false });
  const a = game.ent('p1');
  const b = game.ent('p2');
  Object.assign(a.s, createPainter(200, 160));
  Object.assign(b.s, createPainter(230, 160));
  const before = game.cellsOf(a);
  let seq = 0;
  for (let i = 0; i < 8 && !(b.s.stun > 0); i++) {
    game.onInput(players[0], { seq: ++seq, ax: 1, ay: 0, buttons: i === 0 ? BTN.A : 0, aim: 0 });
    tick(game, room);
  }
  assert.ok(b.s.stun > 0, 'stunned');
  assert.equal(a.splashes, 1);
  assert.ok(game.cellsOf(a) - before > 20, 'a splash of paint');
  const i = Math.floor(b.s.y / KL.CELL) * KL.COLS + Math.floor(b.s.x / KL.CELL);
  assert.equal(game.grid[i], 1, 'under the victim');
  assert.ok(room.events.some((e) => e.e === 'splash' && e.s === 0 && e.v === 1));
});

// Read a snapshot the way the client does and apply its grid part.
function readSnapshot(bytes, grid) {
  const r = new ByteReader(bytes);
  const out = { phase: r.u8(), left: r.f32(), map: r.u8(), ents: [], powers: [] };
  const n = r.u8();
  for (let i = 0; i < n; i++) {
    const e = { slot: r.u8(), flags: r.u8(), ack: r.u16() };
    for (const k of ['x', 'y', 'vx', 'vy', 'fx', 'fy', 'dash', 'cool', 'boost', 'stun']) e[k] = r.f32();
    e.prevA = r.u8();
    e.cells = r.u16();
    e.wide = r.u8();
    e.splashes = r.u8();
    out.ents.push(e);
  }
  const m = r.u8();
  for (let i = 0; i < m; i++) out.powers.push({ id: r.u8(), type: r.u8(), x: r.u16(), y: r.u16() });
  const k = r.u16();
  for (let i = 0; i < k; i++) {
    const idx = r.u16();
    grid[idx] = r.u8();
  }
  const strip = r.u8();
  let at = strip * (KL_CELLS / STRIPS);
  const runs = r.u16();
  for (let i = 0; i < runs; i++) {
    const v = r.u8();
    const len = r.u8();
    grid.fill(v, at, at + len);
    at += len;
  }
  assert.equal(at, (strip + 1) * (KL_CELLS / STRIPS), 'a strip is complete');
  assert.equal(r.remaining, 0);
  return out;
}

test('the grid reaches the clients: every snapshot, and after skipped ones', () => {
  const players = [bot('p1', 0, 'hard'), bot('p2', 1, 'normal'), bot('p3', 2, 'easy'), human('p4', 3)];
  const { room, game } = match(players, { map: 'atelier' });
  const client = new Uint8Array(KL_CELLS);
  const late = new Uint8Array(KL_CELLS);
  for (let i = 0; i < 300; i++) {
    tick(game, room);
    if (i % 3 === 2) continue; // 20 snapshots a second at 30 ticks
    const w = new ByteWriter(256);
    game.snapshot(w);
    const bytes = w.toBytes();
    readSnapshot(bytes, client);
    assert.deepEqual(client, game.grid, `client grid equals the server grid (tick ${i})`);
    // A second client that misses a lot of snapshots.
    if (i < 150 || i % 7 === 0) continue;
    readSnapshot(bytes, late);
  }
  // Catch up with STRIPS snapshots in a row.
  for (let k = 0; k < STRIPS; k++) {
    const w = new ByteWriter(256);
    game.snapshot(w);
    readSnapshot(w.toBytes(), late);
  }
  assert.deepEqual(late, game.grid, 'a client that skipped snapshots is complete again');
});

test('power-ups: wide roller, turbo, paint bomb', () => {
  const players = [human('p1', 0), human('p2', 1)];
  const { room, game } = match(players);
  const a = game.ent('p1');
  game.powers.length = 0;
  run(game, room, 12);
  assert.ok(game.powers.length > 0, 'power-ups appear');
  game.powers.length = 0;
  const p = game.spawnPower(KL_POWER.BOMB);
  Object.assign(a.s, createPainter(p.x, p.y));
  const before = game.cellsOf(a);
  tick(game, room);
  assert.ok(game.cellsOf(a) - before > 80, 'bomb paints a big circle');
  assert.ok(room.events.some((e) => e.e === 'power' && e.type === KL_POWER.BOMB) && room.events.some((e) => e.e === 'bomb'));
  // Wide roller paints a wider band.
  let normal = 0;
  forCellsInDisc(200, 160, KL.BRUSH, () => normal++);
  let wide = 0;
  forCellsInDisc(200, 160, KL.WIDE_BRUSH, () => wide++);
  assert.ok(wide > normal * 2.5);
  game.applyPower(a, KL_POWER.WIDE);
  game.applyPower(a, KL_POWER.TURBO);
  assert.equal(a.wide, KL_POWERS[KL_POWER.WIDE].seconds);
  assert.ok(a.s.boost > 0);
});

test('no power-ups when the setting is off', () => {
  const { room, game } = match([bot('p1', 0), bot('p2', 1)], { powerups: false });
  run(game, room, 30);
  assert.equal(game.powers.length, 0);
  assert.ok(!room.events.some((e) => e.e === 'power'));
});

test('bot matches paint most of the canvas and end with a ranking', () => {
  for (const map of Object.keys(KL_MAPS)) {
    const players = [bot('p1', 0, 'hard'), bot('p2', 1, 'normal'), bot('p3', 2, 'easy'), bot('p4', 3, 'normal')];
    const room = fakeRoom(players);
    const game = kladder.create(room, { duration: 60, seed: 9, map });
    let ms = 0;
    let ticks = 0;
    while (!room.results && ticks < 80 * 30) {
      const t0 = performance.now();
      tick(game, room);
      ms += performance.now() - t0;
      ticks++;
    }
    assert.ok(room.results, `${map}: the match ends`);
    const painted = game.ents.reduce((n, e) => n + game.cellsOf(e), 0);
    assert.ok(painted > game.paintable * 0.6, `${map}: most is painted (${Math.round((painted / game.paintable) * 100)}%)`);
    assert.ok(ms / ticks < 1.5, `${map}: cheap ticks (${(ms / ticks).toFixed(2)} ms)`);
    assert.deepEqual(room.results.columns, ['Geverfd', 'Spetters']);
    const hard = game.ent('p1');
    const easy = game.ent('p3');
    assert.ok(game.cellsOf(hard) > game.cellsOf(easy) * 0.8, `${map}: hard is not worse than easy`);
  }
});

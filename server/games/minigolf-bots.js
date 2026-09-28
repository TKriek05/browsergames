// Minigolf bots: try a fan of angles × powers with the real ball physics,
// score each landing spot with a walking-distance field to the cup (so a
// wall between ball and cup counts), refine around the best shot and add
// some aim noise per level.
import { HOLES, simulateShot, onCourse, MAX_POWER, FRICTION } from '../../shared/games/minigolf.js';

const CELL = 4;
const COLS = 72; // covers x 0..288
const ROWS = 42; // covers y 0..168
const ANGLES = 72;
const POWERS = [0.12, 0.18, 0.25, 0.32, 0.4, 0.48, 0.56, 0.65, 0.75, 0.87, 1];
const WATER_COST = 5000;
const TOP_K = 8;
const NEAR = 30; // short putts: fewer candidates, less aim noise
export const BOT_LEVELS = {
  easy: { angle: 0.26, power: 0.36, think: [1.6, 3] },
  normal: { angle: 0.15, power: 0.22, think: [1.2, 2.2] },
  hard: { angle: 0.07, power: 0.12, think: [0.9, 1.6] },
};

const fields = new Map(); // hole index → Float32Array of distances

// Walking distance from every course cell to the cup (8-neighbour Dijkstra-ish BFS).
export function distanceField(holeIndex) {
  let field = fields.get(holeIndex);
  if (field) return field;
  const hole = HOLES[holeIndex];
  field = new Float32Array(COLS * ROWS).fill(Infinity);
  const open = new Uint8Array(COLS * ROWS);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) open[y * COLS + x] = onCourse(hole, (x + 0.5) * CELL, (y + 0.5) * CELL) ? 1 : 0;
  }
  const start = Math.floor(hole.cup[1] / CELL) * COLS + Math.floor(hole.cup[0] / CELL);
  field[start] = 0;
  const queue = [start];
  const steps = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  // Relaxation until stable (tiny grid, only computed once per hole).
  for (let h = 0; h < queue.length; h++) {
    const cur = queue[h];
    const cx = cur % COLS;
    const cy = (cur - cx) / COLS;
    for (const [dx, dy, cost] of steps) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const ni = ny * COLS + nx;
      if (!open[ni]) continue;
      const d = field[cur] + cost * CELL;
      if (d < field[ni] - 0.01) {
        field[ni] = d;
        queue.push(ni);
      }
    }
  }
  fields.set(holeIndex, field);
  return field;
}

function landingCost(holeIndex, hole, res) {
  if (res.sunk) return -1;
  if (res.water) return WATER_COST;
  const field = distanceField(holeIndex);
  const cx = Math.min(COLS - 1, Math.max(0, Math.floor(res.x / CELL)));
  const cy = Math.min(ROWS - 1, Math.max(0, Math.floor(res.y / CELL)));
  const d = field[cy * COLS + cx];
  // Close to the cup the straight distance is more precise than the grid.
  const straight = Math.hypot(res.x - hole.cup[0], res.y - hole.cup[1]);
  return Number.isFinite(d) ? Math.max(straight, d - CELL) : WATER_COST / 2;
}

// Search for the best shot { a, p, cost } from (x, y), without noise. A
// generator that yields after every simulated shot, so the server can
// spread the work over several ticks. `spread` (radians) makes the bot
// prefer shots that still work when its aim is a bit off.
export function* shotSearch(holeIndex, segs, x, y, spread = 0) {
  const hole = HOLES[holeIndex];
  const cost = (a, p) => landingCost(holeIndex, hole, simulateShot(hole, segs, x, y, a, p));
  const top = []; // the TOP_K best candidates so far, sorted by cost
  const keep = (a, p, c) => {
    if (top.length === TOP_K && c >= top[TOP_K - 1].cost) return;
    top.push({ a, p, cost: c });
    top.sort((m, n) => m.cost - n.cost);
    if (top.length > TOP_K) top.pop();
  };
  // A direct putt at the cup with a few powers first (the usual answer).
  const direct = Math.atan2(hole.cup[1] - y, hole.cup[0] - x);
  const dist = Math.hypot(hole.cup[0] - x, hole.cup[1] - y);
  const needed = Math.sqrt(dist * 2 * FRICTION) / MAX_POWER; // just reaches the cup on a flat green
  for (let k = 0.9; k <= 1.5; k += 0.1) {
    const p = Math.min(1, needed * k + 0.02);
    keep(direct, p, cost(direct, p));
    yield;
  }
  if (top[0].cost < 0 && dist < NEAR) return top[0];
  for (let i = 0; i < ANGLES; i++) {
    const a = (i / ANGLES) * Math.PI * 2;
    for (const p of POWERS) {
      keep(a, p, cost(a, p));
      yield;
    }
  }
  // Robustness: how do the finalists do when the aim is a bit off?
  let best = null;
  for (const c of top) {
    let score = c.cost;
    if (spread > 0) {
      score += cost(c.a - spread, c.p);
      yield;
      score += cost(c.a + spread, c.p);
      yield;
      score /= 3;
    }
    if (!best || score < best.score) best = { ...c, score };
  }
  // Fine-tune around the winner.
  const base = best;
  for (let da = -2; da <= 2; da++) {
    for (let dp = -2; dp <= 2; dp++) {
      if (!da && !dp) continue;
      const a = base.a + da * 0.012;
      const p = Math.max(0.06, Math.min(1, base.p + dp * 0.02));
      const c = cost(a, p);
      if (c < best.cost) best = { a, p, cost: c };
      yield;
    }
  }
  return best;
}

export function bestShot(holeIndex, segs, x, y, spread = 0) {
  const it = shotSearch(holeIndex, segs, x, y, spread);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

// Aim noise per level on top of the best shot.
export function addNoise(shot, holeIndex, x, y, level, rng) {
  const cfg = BOT_LEVELS[level] ?? BOT_LEVELS.normal;
  const noise = () => rng() + rng() - 1; // triangle distribution in -1..1
  const hole = HOLES[holeIndex];
  // Short putts are easier: less noise near the cup.
  const near = Math.hypot(hole.cup[0] - x, hole.cup[1] - y) < NEAR ? 0.5 : 1;
  return {
    a: shot.a + noise() * cfg.angle * near,
    p: Math.max(0.05, Math.min(1, shot.p * (1 + noise() * cfg.power * near))),
  };
}

// The shot a bot actually plays, in one go (tests and tools).
export function botShot(holeIndex, segs, x, y, level, rng) {
  return addNoise(bestShot(holeIndex, segs, x, y, botSpread(level)), holeIndex, x, y, level, rng);
}

export const botSpread = (level) => (BOT_LEVELS[level] ?? BOT_LEVELS.normal).angle * 0.7;

export function botThinkTime(level, rng) {
  const [lo, hi] = (BOT_LEVELS[level] ?? BOT_LEVELS.normal).think;
  return lo + rng() * (hi - lo);
}

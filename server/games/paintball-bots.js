// Spetterveld bots: walk over a coarse grid (breadth-first distance field
// towards the target), strafe while they have a clear shot, turn their view
// at a limited speed and only fire when the target is close to the crosshair.
// Easy bots aim sloppily and react slowly; hard bots are quick and precise.
import { PB_FIELD } from '../../shared/maps/paintball-arenas.js';
import { PB_PHYS, lineOfSight } from '../../shared/physics/paintball.js';
import { PB_RULES as R, wrapAngle } from '../../shared/games/paintball.js';

// lagMs: bots see where you were this long ago (like a human's reaction),
// so strafing makes you harder to hit.
const LEVELS = {
  easy: { think: 0.6, jitter: 0.17, turn: 2.8, reaction: 0.85, cone: 0.2, keep: 90, speed: 0.72, strafe: 0.35, pause: 0.55, lagMs: 260 },
  normal: { think: 0.35, jitter: 0.085, turn: 4.4, reaction: 0.45, cone: 0.12, keep: 110, speed: 0.9, strafe: 0.7, pause: 0.18, lagMs: 180 },
  hard: { think: 0.22, jitter: 0.045, turn: 6.5, reaction: 0.26, cone: 0.08, keep: 130, speed: 1, strafe: 1, pause: 0.04, lagMs: 120 },
};

const CELL = 10;
const COLS = Math.ceil(PB_FIELD.width / CELL);
const ROWS = Math.ceil(PB_FIELD.height / CELL);
const N = COLS * ROWS;
const queue = new Int16Array(N);
const blockedCache = new Map(); // arena key → Uint8Array

function blockedFor(arena) {
  let grid = blockedCache.get(arena.key);
  if (grid) return grid;
  grid = new Uint8Array(N);
  const m = PB_PHYS.RADIUS + 1.5;
  for (let i = 0; i < N; i++) {
    const x = (i % COLS + 0.5) * CELL;
    const y = (Math.floor(i / COLS) + 0.5) * CELL;
    for (const o of arena.obstacles) {
      const inside = o.t === 'can'
        ? Math.hypot(x - o.x, y - o.y) < o.r + m
        : Math.abs(x - o.x) < o.w / 2 + m && Math.abs(y - o.y) < o.h / 2 + m;
      if (inside) { grid[i] = 1; break; }
    }
  }
  blockedCache.set(arena.key, grid);
  return grid;
}

const cellOf = (x, y) => Math.min(ROWS - 1, Math.max(0, Math.floor(y / CELL))) * COLS + Math.min(COLS - 1, Math.max(0, Math.floor(x / CELL)));

export function createPaintBot() {
  return {
    think: 0, target: null, visible: false, seen: 0, jitter: 0, pause: 0,
    strafe: 1, strafeT: 0, field: new Int16Array(N), goal: -1, goalX: 0, goalY: 0,
    out: { ax: 0, ay: 0, yaw: 0, fire: false, reload: false },
  };
}

// Distance (in cells) from every free cell to `goal`.
function buildField(b, blocked, goal) {
  const f = b.field;
  f.fill(-1);
  b.goal = goal;
  let head = 0;
  let tail = 0;
  queue[tail++] = goal;
  f[goal] = 0;
  while (head < tail) {
    const cur = queue[head++];
    const cx = cur % COLS;
    const cy = (cur - cx) / COLS;
    for (let k = 0; k < 4; k++) {
      const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const ni = ny * COLS + nx;
      if (f[ni] !== -1 || blocked[ni]) continue;
      f[ni] = f[cur] + 1;
      queue[tail++] = ni;
    }
  }
}

// Unit direction towards the best neighbouring cell, or null at the goal.
function followField(b, s, out) {
  const f = b.field;
  const c = cellOf(s.x, s.y);
  const cx = c % COLS;
  const cy = (c - cx) / COLS;
  let best = f[c] >= 0 ? f[c] : 32767;
  let bx = -1;
  let by = -1;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const v = f[ny * COLS + nx];
      // Diagonals only when both sides are open (no corner cutting).
      if (dx && dy && (f[cy * COLS + nx] < 0 || f[ny * COLS + cx] < 0)) continue;
      if (v >= 0 && v < best) { best = v; bx = nx; by = ny; }
    }
  }
  if (bx < 0) {
    if (f[c] === 0) return null;
    // Off the field (pushed into a margin cell): head for the goal directly.
    out.x = b.goalX - s.x;
    out.y = b.goalY - s.y;
  } else {
    out.x = (bx + 0.5) * CELL - s.x;
    out.y = (by + 0.5) * CELL - s.y;
  }
  const l = Math.hypot(out.x, out.y) || 1;
  out.x /= l;
  out.y /= l;
  return out;
}

function pickTarget(e, game) {
  let best = null;
  let bestScore = Infinity;
  for (const o of game.ents) {
    if (o === e || !o.alive) continue;
    const d = Math.hypot(o.s.x - e.s.x, o.s.y - e.s.y);
    const seen = lineOfSight(game.obstacles, e.s.x, e.s.y, o.s.x, o.s.y);
    const score = d * (seen ? 1 : 1.8) * (o.shield > 0 ? 2 : 1);
    if (score < bestScore) { bestScore = score; best = o; }
  }
  return best;
}

const dir = { x: 0, y: 0 };
const seen = { x: 0, y: 0 };

export function stepPaintBot(e, game, dt, rng) {
  const cfg = LEVELS[e.player.botLevel] ?? LEVELS.normal;
  const b = e.bot;
  const out = b.out;
  const s = e.s;
  const blocked = blockedFor(game.arena);
  out.fire = false;
  out.reload = false;
  b.think -= dt;
  b.strafeT -= dt;
  b.pause -= dt;

  if (b.think <= 0) {
    b.think = cfg.think * (0.8 + rng() * 0.4);
    b.jitter = (rng() - 0.5) * 2 * cfg.jitter;
    b.target = pickTarget(e, game);
    let gx;
    let gy;
    if (b.target) {
      gx = b.target.s.x;
      gy = b.target.s.y;
    } else {
      // Nobody around: roam to a random open spot.
      gx = 20 + rng() * (PB_FIELD.width - 40);
      gy = 20 + rng() * (PB_FIELD.height - 40);
    }
    let goal = cellOf(gx, gy);
    if (blocked[goal]) {
      for (let k = 1; k < 4 && blocked[goal]; k++) goal = cellOf(gx + (rng() - 0.5) * CELL * 4 * k, gy + (rng() - 0.5) * CELL * 4 * k);
    }
    b.goalX = gx;
    b.goalY = gy;
    if (goal !== b.goal || rng() < 0.3) buildField(b, blocked, goal);
  }
  if (b.strafeT <= 0) {
    b.strafe = rng() < 0.5 ? -1 : 1;
    b.strafeT = 0.6 + rng() * 1.2;
  }

  const t = b.target && b.target.alive ? b.target : null;
  b.visible = !!t && lineOfSight(game.obstacles, s.x, s.y, t.s.x, t.s.y);
  let mx = 0;
  let my = 0;
  if (t && b.visible) {
    const dx = t.s.x - s.x;
    const dy = t.s.y - s.y;
    const d = Math.hypot(dx, dy) || 1;
    const fx = dx / d;
    const fy = dy / d;
    const approach = d > cfg.keep + 25 ? 1 : d < cfg.keep - 35 ? -0.7 : 0;
    mx = fx * approach - fy * b.strafe * cfg.strafe;
    my = fy * approach + fx * b.strafe * cfg.strafe;
    b.seen += dt;
  } else {
    b.seen = 0;
    if (followField(b, s, dir)) {
      mx = dir.x;
      my = dir.y;
    }
  }
  const ml = Math.hypot(mx, my);
  out.ax = ml > 0 ? (mx / ml) * cfg.speed : 0;
  out.ay = ml > 0 ? (my / ml) * cfg.speed : 0;

  // Turn the view at a limited speed (towards where the target was a moment
  // ago); fire when the crosshair is close enough.
  let want = ml > 0 ? Math.atan2(my, mx) : e.yaw;
  if (t && b.visible) {
    const p = game.history.positionAt(t.player.slot, game.room.now() - cfg.lagMs, seen) ? seen : t.s;
    want = Math.atan2(p.y - s.y, p.x - s.x) + b.jitter;
  }
  const diff = wrapAngle(want - e.yaw);
  const maxTurn = cfg.turn * dt;
  out.yaw = wrapAngle(e.yaw + (diff > maxTurn ? maxTurn : diff < -maxTurn ? -maxTurn : diff));
  if (t && b.visible && b.seen >= cfg.reaction && b.pause <= 0 && e.ammo > 0 && e.reload <= 0
    && Math.abs(wrapAngle(want - out.yaw)) < cfg.cone) {
    out.fire = true;
    b.pause = cfg.pause * (0.5 + rng());
    b.jitter = Math.max(-cfg.jitter, Math.min(cfg.jitter, b.jitter + (rng() - 0.5) * cfg.jitter));
  }
  if (!b.visible && e.reload <= 0 && e.ammo < R.HOPPER / 2) out.reload = true;
  return out;
}

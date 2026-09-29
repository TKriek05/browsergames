// Spetterveld movement and line tests. Runs on the server (authoritative)
// and on the client (prediction), so it is deterministic: only + - * / and
// Math.sqrt, every stored value through Math.fround (float32 like the snapshot).
// The wish direction (ax, ay) is already in world space: the client turns
// "forward/strafe + view angle" into it before quantizing and sending.
import { PB_FIELD } from '../maps/paintball-arenas.js';

export const PB_PHYS = {
  DT: 1 / 30,
  RADIUS: 4, // body (collision)
  HIT_RADIUS: 5.2, // a little generous for shots
  SPEED: 50,
  SPRINT: 1.4, // speed factor with the sprint power-up (s.boost > 0)
  ACCEL: 420, // per second, towards the wish velocity
  EYE: 15, // eye height (3D only)
  GUN: 13, // shots fly at this height (3D only)
};

const f = Math.fround;

export function createRunner(x = 0, y = 0) {
  return { x, y, vx: 0, vy: 0, boost: 0 };
}

export function stepRunner(s, ax, ay, dt, obstacles) {
  const P = PB_PHYS;
  const speed = s.boost > 0 ? P.SPEED * P.SPRINT : P.SPEED;
  if (s.boost > 0) s.boost = f(s.boost - dt > 0 ? s.boost - dt : 0);
  let dvx = ax * speed - s.vx;
  let dvy = ay * speed - s.vy;
  const len = Math.sqrt(dvx * dvx + dvy * dvy);
  const max = P.ACCEL * dt;
  if (len > max) {
    dvx = (dvx / len) * max;
    dvy = (dvy / len) * max;
  }
  s.vx = f(s.vx + dvx);
  s.vy = f(s.vy + dvy);
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  collide(s, obstacles, P.RADIUS);
  s.x = f(s.x);
  s.y = f(s.y);
}

// Push a circle out of every obstacle and keep it inside the field.
export function collide(s, obstacles, r) {
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    if (o.t === 'can') {
      const dx = s.x - o.x;
      const dy = s.y - o.y;
      const min = o.r + r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        s.x = o.x + (dx / d) * min;
        s.y = o.y + (dy / d) * min;
      } else s.x = o.x + min;
      continue;
    }
    const hw = o.w / 2;
    const hh = o.h / 2;
    const x0 = o.x - hw, x1 = o.x + hw, y0 = o.y - hh, y1 = o.y + hh;
    if (s.x + r <= x0 || s.x - r >= x1 || s.y + r <= y0 || s.y - r >= y1) continue;
    const cx = s.x < x0 ? x0 : s.x > x1 ? x1 : s.x;
    const cy = s.y < y0 ? y0 : s.y > y1 ? y1 : s.y;
    const dx = s.x - cx;
    const dy = s.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) continue;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      s.x = cx + (dx / d) * r;
      s.y = cy + (dy / d) * r;
    } else {
      // Centre inside the box: leave along the shortest axis.
      const left = s.x - x0, right = x1 - s.x, top = s.y - y0, bottom = y1 - s.y;
      const m = Math.min(left, right, top, bottom);
      if (m === left) s.x = x0 - r;
      else if (m === right) s.x = x1 + r;
      else if (m === top) s.y = y0 - r;
      else s.y = y1 + r;
    }
  }
  if (s.x < r) s.x = r;
  if (s.x > PB_FIELD.width - r) s.x = PB_FIELD.width - r;
  if (s.y < r) s.y = r;
  if (s.y > PB_FIELD.height - r) s.y = PB_FIELD.height - r;
}

// --- Rays (shots, line of sight) ---------------------------------------------------------
// Distance along the unit ray (dx, dy) to a circle, or Infinity.
export function rayCircle(x0, y0, dx, dy, cx, cy, r) {
  const ox = x0 - cx;
  const oy = y0 - cy;
  const b = ox * dx + oy * dy;
  const c = ox * ox + oy * oy - r * r;
  if (c <= 0) return 0; // starts inside
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : Infinity;
}

// Distance to an axis-aligned box (slab test), or Infinity. Writes the face normal into n.
export function rayBox(x0, y0, dx, dy, o, n = null) {
  const hw = o.w / 2;
  const hh = o.h / 2;
  let tmin = -Infinity;
  let tmax = Infinity;
  let nx = 0;
  let ny = 0;
  if (Math.abs(dx) < 1e-9) {
    if (x0 < o.x - hw || x0 > o.x + hw) return Infinity;
  } else {
    let t1 = (o.x - hw - x0) / dx;
    let t2 = (o.x + hw - x0) / dx;
    let side = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; side = 1; }
    if (t1 > tmin) { tmin = t1; nx = side; ny = 0; }
    if (t2 < tmax) tmax = t2;
  }
  if (Math.abs(dy) < 1e-9) {
    if (y0 < o.y - hh || y0 > o.y + hh) return Infinity;
  } else {
    let t1 = (o.y - hh - y0) / dy;
    let t2 = (o.y + hh - y0) / dy;
    let side = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; side = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = side; }
    if (t2 < tmax) tmax = t2;
  }
  if (tmax < tmin || tmax < 0) return Infinity;
  if (n) { n.x = nx; n.y = ny; }
  return tmin > 0 ? tmin : 0;
}

// First obstacle (or the field edge) along the ray. Returns the distance;
// hit.nx/ny = surface normal, hit.obstacle = index (-1 = field edge).
export function raycast(obstacles, x0, y0, dx, dy, maxDist, hit = {}) {
  let best = maxDist;
  let bi = -2;
  const n = { x: 0, y: 0 };
  let nx = 0;
  let ny = 0;
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    let t;
    if (o.t === 'can') {
      t = rayCircle(x0, y0, dx, dy, o.x, o.y, o.r);
      if (t < best) {
        const px = x0 + dx * t - o.x;
        const py = y0 + dy * t - o.y;
        const l = Math.sqrt(px * px + py * py) || 1;
        nx = px / l;
        ny = py / l;
      }
    } else {
      t = rayBox(x0, y0, dx, dy, o, n);
      if (t < best) { nx = n.x; ny = n.y; }
    }
    if (t < best) { best = t; bi = i; hit.nx = nx; hit.ny = ny; }
  }
  // Field edge (the net).
  const W = PB_FIELD.width;
  const H = PB_FIELD.height;
  const edges = [
    dx > 0 ? (W - x0) / dx : dx < 0 ? -x0 / dx : Infinity,
    dy > 0 ? (H - y0) / dy : dy < 0 ? -y0 / dy : Infinity,
  ];
  if (edges[0] < best) { best = edges[0]; bi = -1; hit.nx = dx > 0 ? -1 : 1; hit.ny = 0; }
  if (edges[1] < best) { best = edges[1]; bi = -1; hit.nx = 0; hit.ny = dy > 0 ? -1 : 1; }
  hit.obstacle = bi;
  return best;
}

export function lineOfSight(obstacles, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-6) return true;
  return raycast(obstacles, x0, y0, dx / d, dy / d, d) >= d - 0.01;
}

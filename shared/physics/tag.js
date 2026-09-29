// Movement physics for Neon Tikkertje. Runs on the server (authoritative) and
// on the client (prediction), so it must be pure and deterministic:
// only + - * / and Math.sqrt (IEEE-exact everywhere), results rounded to
// float32 so they match the snapshot encoding bit for bit.
import { TAG_FIELD } from '../maps/tag-arenas.js';

export const TAG_PHYS = {
  DT: 1 / 30,
  ACCEL: 720, // px/s^2
  DRAG: 6, // velocity damping per second
  MAX_SPEED: 92, // px/s
  IT_SPEED: 100, // the tagger is a bit faster, otherwise nobody gets caught
  RADIUS: 5,
  STUN_TIME: 0.8, // a freshly tagged player is frozen this long (s)
  IMMUNE_TIME: 1.5, // the previous tagger cannot be tagged back this long (s)
  BOOST_SPEED: 1.35, // turbo power-up: top speed ×
  BOOST_ACCEL: 1.3, // … and acceleration ×
  SLOW_SPEED: 0.55, // hit by a freeze wave: top speed ×
};

const f = Math.fround;

// s: { x, y, vx, vy, stun, boost?, slow? }  ax/ay: -1..1 (already quantized)
// boost/slow: seconds left of a turbo or a freeze wave (power-ups).
export function stepRunner(s, ax, ay, dt, walls, isIt) {
  if (s.stun > 0) {
    s.stun = f(Math.max(0, s.stun - dt));
    ax = 0;
    ay = 0;
  }
  let speedK = 1;
  let accelK = 1;
  if (s.boost > 0) {
    s.boost = f(Math.max(0, s.boost - dt));
    speedK *= TAG_PHYS.BOOST_SPEED;
    accelK = TAG_PHYS.BOOST_ACCEL;
  }
  if (s.slow > 0) {
    s.slow = f(Math.max(0, s.slow - dt));
    speedK *= TAG_PHYS.SLOW_SPEED;
  }
  const len = Math.sqrt(ax * ax + ay * ay);
  if (len > 1) {
    ax /= len;
    ay /= len;
  }

  let vx = s.vx + ax * TAG_PHYS.ACCEL * accelK * dt;
  let vy = s.vy + ay * TAG_PHYS.ACCEL * accelK * dt;
  const damp = 1 / (1 + TAG_PHYS.DRAG * dt);
  vx *= damp;
  vy *= damp;

  const max = (isIt ? TAG_PHYS.IT_SPEED : TAG_PHYS.MAX_SPEED) * speedK;
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed > max) {
    vx = (vx / speed) * max;
    vy = (vy / speed) * max;
  }

  s.vx = vx;
  s.vy = vy;
  s.x += vx * dt;
  s.y += vy * dt;
  collide(s, walls, TAG_PHYS.RADIUS);

  s.x = f(s.x);
  s.y = f(s.y);
  s.vx = f(s.vx);
  s.vy = f(s.vy);
}

function collide(s, walls, r) {
  for (let i = 0; i < walls.length; i++) collideRect(s, walls[i], r);

  // Field bounds
  if (s.x < r) { s.x = r; if (s.vx < 0) s.vx = 0; }
  if (s.x > TAG_FIELD.width - r) { s.x = TAG_FIELD.width - r; if (s.vx > 0) s.vx = 0; }
  if (s.y < r) { s.y = r; if (s.vy < 0) s.vy = 0; }
  if (s.y > TAG_FIELD.height - r) { s.y = TAG_FIELD.height - r; if (s.vy > 0) s.vy = 0; }
}

function collideRect(s, rect, r) {
  const cx = s.x < rect.x ? rect.x : s.x > rect.x + rect.w ? rect.x + rect.w : s.x;
  const cy = s.y < rect.y ? rect.y : s.y > rect.y + rect.h ? rect.y + rect.h : s.y;
  const dx = s.x - cx;
  const dy = s.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return;

  let nx, ny, push;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    nx = dx / d;
    ny = dy / d;
    push = r - d;
  } else {
    // Centre inside the rectangle: leave along the shortest axis.
    const left = s.x - rect.x, right = rect.x + rect.w - s.x;
    const top = s.y - rect.y, bottom = rect.y + rect.h - s.y;
    const m = Math.min(left, right, top, bottom);
    nx = m === left ? -1 : m === right ? 1 : 0;
    ny = nx !== 0 ? 0 : m === top ? -1 : 1;
    push = m + r;
  }
  s.x += nx * push;
  s.y += ny * push;
  const vn = s.vx * nx + s.vy * ny;
  if (vn < 0) {
    s.vx -= vn * nx;
    s.vy -= vn * ny;
  }
}

export function touching(a, b, reach = TAG_PHYS.RADIUS * 2) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy <= reach * reach;
}

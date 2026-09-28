// Ship physics for Rotsregen (inertia, wrap-around). Shared by server and
// client prediction: + - * / and Math.sqrt only (rotation via a short Taylor
// series), everything rounded to float32.
export const ROCKS_FIELD = { width: 320, height: 180 };

export const SHIP_PHYS = {
  DT: 1 / 30,
  TURN_RATE: 4.2, // rad/s at full stick
  THRUST: 150,
  DRAG: 0.45, // velocity damping per second
  MAX_SPEED: 150,
  RADIUS: 5,
};

const f = Math.fround;

export function createShip(x = ROCKS_FIELD.width / 2, y = ROCKS_FIELD.height / 2) {
  return { x, y, vx: 0, vy: 0, hx: 0, hy: -1 };
}

// ax: rotate (-1..1), thrust: boolean.
export function stepShip(s, ax, thrust, dt) {
  const P = SHIP_PHYS;
  const turn = ax < -1 ? -1 : ax > 1 ? 1 : ax;
  if (turn !== 0) {
    const th = turn * P.TURN_RATE * dt;
    const t2 = th * th;
    const c = 1 - t2 / 2 + (t2 * t2) / 24;
    const sn = th - (th * t2) / 6 + (th * t2 * t2) / 120;
    const nx = s.hx * c - s.hy * sn;
    const ny = s.hx * sn + s.hy * c;
    const len = Math.sqrt(nx * nx + ny * ny);
    s.hx = f(nx / len);
    s.hy = f(ny / len);
  }
  let vx = s.vx;
  let vy = s.vy;
  if (thrust) {
    vx += s.hx * P.THRUST * dt;
    vy += s.hy * P.THRUST * dt;
  }
  const damp = 1 / (1 + P.DRAG * dt);
  vx *= damp;
  vy *= damp;
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed > P.MAX_SPEED) {
    vx = (vx / speed) * P.MAX_SPEED;
    vy = (vy / speed) * P.MAX_SPEED;
  }
  s.vx = f(vx);
  s.vy = f(vy);
  s.x = f(wrap(s.x + s.vx * dt, ROCKS_FIELD.width));
  s.y = f(wrap(s.y + s.vy * dt, ROCKS_FIELD.height));
}

export function wrap(v, size) {
  if (v < 0) return v + size;
  if (v >= size) return v - size;
  return v;
}

// Shortest difference on a wrapping axis.
export function wrapDelta(d, size) {
  if (d > size / 2) return d - size;
  if (d < -size / 2) return d + size;
  return d;
}

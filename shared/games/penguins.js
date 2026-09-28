// Pinguïnbotsen: values and movement both sides need. Penguins slide over a
// round ice floe (low friction), a dash gives a short hard push, and whoever
// is pushed off the (shrinking) floe falls into the sea.
// Movement is deterministic (only + - * / and Math.sqrt, float32 via
// Math.fround) so the owner's client can predict it; collisions between
// penguins and falling off are decided by the server only.

export const PG = {
  DT: 1 / 30,
  RADIUS: 7,
  ACCEL: 190, // with the stick fully pushed
  FRICTION: 1.1, // per second (ice: low)
  MAX_SPEED: 95,
  DASH_SPEED: 175, // added in the stick (or last move) direction
  DASH_S: 0.28, // a dashing penguin weighs more in collisions
  DASH_COOLDOWN_S: 1.3,
  DASH_MASS: 3,
  BOUNCE: 0.9, // restitution between penguins
  FLOE_START: 125, // floe radius at the start of a round
  FLOE_END: 58,
  SHRINK_AFTER_S: 12, // then it melts linearly …
  SHRINK_S: 45, // … over this many seconds
  OVERTIME_AFTER_S: 15, // then, if still nobody has won, it melts further
  OVERTIME_SHRINK: 2.5, // units per second
  FLOE_MIN: 14,
  ROUND_WINS: 3,
};

export const PG_FLAG = { BOT: 1, CONNECTED: 2, ALIVE: 4, DASH: 8, FALLING: 16 };

const f = Math.fround;

export function createPenguin(x = 0, y = 0) {
  return { x, y, vx: 0, vy: 0, fx: 1, fy: 0, dash: 0, cool: 0, prevA: 0 };
}

// Floe radius `t` seconds into the round. After the normal melt a long
// round keeps shrinking slowly, so it always ends.
export function floeRadius(t) {
  const k = (t - PG.SHRINK_AFTER_S) / PG.SHRINK_S;
  if (k <= 0) return PG.FLOE_START;
  if (k < 1) return PG.FLOE_START + (PG.FLOE_END - PG.FLOE_START) * k;
  const late = t - PG.SHRINK_AFTER_S - PG.SHRINK_S - PG.OVERTIME_AFTER_S;
  return late > 0 ? Math.max(PG.FLOE_MIN, PG.FLOE_END - late * PG.OVERTIME_SHRINK) : PG.FLOE_END;
}

// One tick. ax/ay: stick (quantized), a: dash button held (edge-triggered here).
export function stepPenguin(s, ax, ay, a, dt) {
  const P = PG;
  const mag = Math.sqrt(ax * ax + ay * ay);
  if (mag > 0.15) {
    const k = mag > 1 ? 1 / mag : 1;
    s.vx += ax * k * P.ACCEL * dt;
    s.vy += ay * k * P.ACCEL * dt;
    s.fx = f(ax / mag);
    s.fy = f(ay / mag);
  }
  if (s.cool > 0) s.cool = f(s.cool - dt > 0 ? s.cool - dt : 0);
  if (s.dash > 0) s.dash = f(s.dash - dt > 0 ? s.dash - dt : 0);
  if (a && !s.prevA && s.cool <= 0) {
    s.vx += s.fx * P.DASH_SPEED;
    s.vy += s.fy * P.DASH_SPEED;
    s.dash = f(P.DASH_S);
    s.cool = f(P.DASH_COOLDOWN_S);
  }
  s.prevA = a ? 1 : 0;
  // Ice friction, and a speed limit that only applies when not dashing.
  const drag = 1 - P.FRICTION * dt;
  s.vx *= drag;
  s.vy *= drag;
  const sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
  const max = s.dash > 0 ? P.MAX_SPEED + P.DASH_SPEED : P.MAX_SPEED;
  if (sp > max) {
    s.vx = (s.vx / sp) * max;
    s.vy = (s.vy / sp) * max;
  }
  s.vx = f(s.vx);
  s.vy = f(s.vy);
  s.x = f(s.x + s.vx * dt);
  s.y = f(s.y + s.vy * dt);
}

// Two penguins bump: push apart and exchange momentum along the contact
// normal. A dashing penguin is heavier, so it wins the push. Returns the
// impact speed (0 = no contact).
export function bump(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const min = PG.RADIUS * 2;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min || d2 < 1e-9) return 0;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  const ma = a.dash > 0 ? PG.DASH_MASS : 1;
  const mb = b.dash > 0 ? PG.DASH_MASS : 1;
  const overlap = min - d;
  a.x = f(a.x - nx * overlap * (mb / (ma + mb)));
  a.y = f(a.y - ny * overlap * (mb / (ma + mb)));
  b.x = f(b.x + nx * overlap * (ma / (ma + mb)));
  b.y = f(b.y + ny * overlap * (ma / (ma + mb)));
  const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (rel <= 0) return 0; // already moving apart
  const j = ((1 + PG.BOUNCE) * rel) / (1 / ma + 1 / mb);
  a.vx = f(a.vx - (j / ma) * nx);
  a.vy = f(a.vy - (j / ma) * ny);
  b.vx = f(b.vx + (j / mb) * nx);
  b.vy = f(b.vy + (j / mb) * ny);
  return rel;
}

// Angle travels as i16 (facing direction).
export const angleToI16 = (a) => Math.round(Math.max(-Math.PI, Math.min(Math.PI, a)) / Math.PI * 32767);
export const i16ToAngle = (v) => (v / 32767) * Math.PI;

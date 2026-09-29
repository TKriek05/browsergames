// Pinguïnbotsen: values and movement both sides need. Penguins slide over a
// round ice floe (low friction), a dash gives a short hard push, and whoever
// is pushed off the (shrinking) floe falls into the sea.
// Movement is deterministic (only + - * / and Math.sqrt, float32 via
// Math.fround) so the owner's client can predict it; collisions between
// penguins and falling off are decided by the server only. A hard hit stuns
// (less grip for a moment); stun and the turbo/grip power-ups are part of
// the predicted state, so the owner replays them exactly like the server.

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
  PUNCH: 10, // extra knockback from a dashing penguin
  KNOCK_MAX: 130, // speed cap for the one that gets hit
  STUN_S: 0.2, // after being hit by a dash: less grip …
  STUN_GRIP: 0.6, // … (steering force factor) …
  OVERSPEED_DRAG: 10, // … and the knockback speed fades out instead of being cut off
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

// Power-ups on the floe (setting 'powerups'). The id is the index and the
// wire value. Turbo and grip change the shared movement (predicted); heavy
// and punch only matter in collisions (server); shock acts at once.
export const PG_POWER = { TURBO: 0, GRIP: 1, HEAVY: 2, PUNCH: 3, SHOCK: 4 };
export const PG_POWERS = [
  { id: 'turbo', name: 'Visje', tip: 'Je glijdt harder', color: '#ffb347', seconds: 6, weight: 1 },
  { id: 'grip', name: 'IJzers', tip: 'Grip op het ijs', color: '#9fd8ff', seconds: 8, weight: 0.9 },
  { id: 'heavy', name: 'Zwaargewicht', tip: 'Jij duwt, niemand duwt jou', color: '#8a8fa8', seconds: 7, weight: 0.9 },
  { id: 'punch', name: 'Bokshandschoen', tip: 'Je volgende duw is een knaller', color: '#ff5a5a', seconds: 10, weight: 0.8 },
  { id: 'shock', name: 'Schokgolf', tip: 'Iedereen vliegt weg', color: '#ffe14d', seconds: 0, weight: 0.6 },
];
export const PG_POWER_RULES = {
  MAX: 2,
  EVERY_S: [4, 6.5],
  LIFE_S: 14,
  RADIUS: 6,
  TURBO_ACCEL: 1.5,
  TURBO_SPEED: 1.35,
  GRIP_FRICTION: 4.5, // per second, instead of FRICTION
  HEAVY_MASS: 3.5,
  PUNCH_FACTOR: 3.2, // knockback multiplier of a punch dash
  SHOCK_RANGE: 55,
  SHOCK_SPEED: 190,
};

const f = Math.fround;

export function createPenguin(x = 0, y = 0) {
  return { x, y, vx: 0, vy: 0, fx: 1, fy: 0, dash: 0, cool: 0, prevA: 0, stun: 0, boost: 0, grip: 0 };
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
  const R = PG_POWER_RULES;
  const mag = Math.sqrt(ax * ax + ay * ay);
  if (mag > 0.15) {
    const k = mag > 1 ? 1 / mag : 1;
    const accel = P.ACCEL * (s.stun > 0 ? P.STUN_GRIP : 1) * (s.boost > 0 ? R.TURBO_ACCEL : 1);
    s.vx += ax * k * accel * dt;
    s.vy += ay * k * accel * dt;
    s.fx = f(ax / mag);
    s.fy = f(ay / mag);
  }
  if (s.cool > 0) s.cool = f(s.cool - dt > 0 ? s.cool - dt : 0);
  if (s.dash > 0) s.dash = f(s.dash - dt > 0 ? s.dash - dt : 0);
  if (s.stun > 0) s.stun = f(s.stun - dt > 0 ? s.stun - dt : 0);
  if (s.boost > 0) s.boost = f(s.boost - dt > 0 ? s.boost - dt : 0);
  if (s.grip > 0) s.grip = f(s.grip - dt > 0 ? s.grip - dt : 0);
  if (a && !s.prevA && s.cool <= 0 && s.stun <= 0) {
    s.vx += s.fx * P.DASH_SPEED;
    s.vy += s.fy * P.DASH_SPEED;
    s.dash = f(P.DASH_S);
    s.cool = f(P.DASH_COOLDOWN_S);
  }
  s.prevA = a ? 1 : 0;
  // Ice friction (crampons: much more), and a speed limit: higher while
  // dashing; a stunned penguin's knockback fades out instead.
  const drag = 1 - (s.grip > 0 ? R.GRIP_FRICTION : P.FRICTION) * dt;
  s.vx *= drag;
  s.vy *= drag;
  const sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
  const top = s.boost > 0 ? P.MAX_SPEED * R.TURBO_SPEED : P.MAX_SPEED;
  if (sp > top) {
    let want = s.dash > 0 ? top + P.DASH_SPEED : top;
    if (s.stun > 0) {
      const fade = sp - (sp - top) * P.OVERSPEED_DRAG * dt;
      if (fade > want) want = fade;
    }
    if (sp > want) {
      s.vx = (s.vx / sp) * want;
      s.vy = (s.vy / sp) * want;
    }
  }
  s.vx = f(s.vx);
  s.vy = f(s.vy);
  s.x = f(s.x + s.vx * dt);
  s.y = f(s.y + s.vy * dt);
}

// Collision mass: a dashing penguin is heavier (the server multiplies in the
// heavy power-up).
export const penguinMass = (s) => (s.dash > 0 ? PG.DASH_MASS : 1);

// Two penguins bump: push apart and exchange momentum along the contact
// normal. A dashing penguin is heavier, so it wins the push. Returns the
// impact speed (0 = no contact). `hit.nx/ny` (optional out) gets the normal a → b.
export function bump(a, b, ma = penguinMass(a), mb = penguinMass(b), hit = null) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const min = PG.RADIUS * 2;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min || d2 < 1e-9) return 0;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  if (hit) {
    hit.nx = nx;
    hit.ny = ny;
  }
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

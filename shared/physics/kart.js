// Kart physics for Turbo Kart GP. Runs on the server and on the client
// (prediction), so it is deterministic: only + - * / and Math.sqrt at
// runtime (rotations use a short Taylor series; the spin step is a literal)
// and every stored value is rounded to float32.
//
// Buttons: A = gas, B = drift (hold while steering, release for a mini
// turbo), X = use item. Stick: x = steer, up = gas, down = brake/reverse.
import { BTN } from '../messages.js';
import { trackQuery, WALL_MARGIN } from '../maps/kart-tracks.js';
import { ITEM } from '../games/kartrace.js';

export const KART_PHYS = {
  DT: 1 / 30,
  RADIUS: 7,
  MAX_SPEED: 172,
  OFFROAD_SPEED: 82,
  BOOST_SPEED: 236,
  REVERSE_SPEED: 48,
  ACCEL: 118,
  BOOST_ACCEL: 380,
  BRAKE: 260,
  COAST: 55,
  OVERSPEED_DECEL: 230,
  TURN_RATE: 2.35, // rad/s at speed
  TURN_FULL_SPEED: 45, // below this the kart turns slower (like a real car)
  DRIFT_MIN_SPEED: 90,
  DRIFT_BASE: 0.95,
  DRIFT_STEER: 0.5,
  DRIFT_SLIP: 0.2,
  SLIP_RESPONSE: 6,
  CHARGE_1: 0.75, // drift this long for a blue mini turbo…
  CHARGE_2: 1.6, // …or an orange one
  MINI_1: 0.6,
  MINI_2: 1.1,
  TURBO_S: 1.3,
  PAD_S: 0.9,
  PAD_RADIUS: 20,
  WALL_DAMP: 0.93, // speed kept per tick while scraping a barrier
  SPIN_DAMP: 0.9,
  SPIN_COS: 0.9210609940028851, // 0.4 rad per tick while spinning out
  SPIN_SIN: 0.3894183423086505,
};

const f = Math.fround;
const q = { seg: 0, dist: 0, lateral: 0, nx: 0, ny: 0 };

export function createKartState() {
  return { x: 0, y: 0, hx: 1, hy: 0, v: 0, vs: 0, drift: 0, charge: 0, boost: 0, spin: 0, item: 0, prev: 0, off: 0 };
}

export const KART_STATE_KEYS = ['x', 'y', 'hx', 'hy', 'v', 'vs', 'drift', 'charge', 'boost', 'spin', 'item', 'prev', 'off'];

// Rotate the heading by a small angle th (|th| < 0.2) and renormalize.
function rotate(s, c, sn) {
  const nx = s.hx * c - s.hy * sn;
  const ny = s.hx * sn + s.hy * c;
  const len = Math.sqrt(nx * nx + ny * ny);
  s.hx = nx / len;
  s.hy = ny / len;
}
function rotateBy(s, th) {
  const t2 = th * th;
  rotate(s, 1 - t2 / 2 + (t2 * t2) / 24, th - (th * t2) / 6 + (th * t2 * t2) / 120);
}

// One fixed step. Sets s.fired (item to spawn, server only) and s.wall
// (scraped a barrier this step) as outputs; they are not part of the state.
export function stepKart(s, ax, ay, buttons, dt, track) {
  const P = KART_PHYS;
  const pressed = buttons & ~s.prev;
  s.prev = buttons;
  s.fired = 0;
  s.wall = 0;

  let steer = ax < -1 ? -1 : ax > 1 ? 1 : ax;
  const brake = ay > 0.5;
  let gas = !brake && ((buttons & BTN.A) !== 0 || ay < -0.5);
  const driftHeld = (buttons & BTN.B) !== 0;

  if (pressed & BTN.X && s.item) {
    if (s.item === ITEM.TURBO) s.boost = s.boost > P.TURBO_S ? s.boost : P.TURBO_S;
    else s.fired = s.item;
    s.item = 0;
  }

  let v = s.v;
  if (s.spin > 0) {
    s.spin = s.spin - dt > 0 ? s.spin - dt : 0;
    rotate(s, P.SPIN_COS, P.SPIN_SIN);
    v *= P.SPIN_DAMP;
    s.vs *= 0.8;
    s.drift = 0;
    s.charge = 0;
    steer = 0;
    gas = false;
  }

  // --- Throttle ---
  let top = s.off ? P.OFFROAD_SPEED : P.MAX_SPEED;
  if (s.boost > 0) {
    top = P.BOOST_SPEED;
    s.boost = s.boost - dt > 0 ? s.boost - dt : 0;
  }
  if (gas) {
    if (v < top) {
      v += (s.boost > 0 ? P.BOOST_ACCEL : P.ACCEL) * dt;
      if (v > top) v = top;
    }
  } else if (brake) {
    v -= P.BRAKE * dt;
    if (v < -P.REVERSE_SPEED) v = -P.REVERSE_SPEED;
  } else if (v > 0) {
    v = v - P.COAST * dt > 0 ? v - P.COAST * dt : 0;
  } else if (v < 0) {
    v = v + P.COAST * dt < 0 ? v + P.COAST * dt : 0;
  }
  if (v > top) v = v - P.OVERSPEED_DECEL * dt > top ? v - P.OVERSPEED_DECEL * dt : top;

  // --- Drift: hold B while steering at speed; release for a mini turbo ---
  if (s.drift === 0) {
    if (driftHeld && s.spin <= 0 && (steer > 0.35 || steer < -0.35) && v > P.DRIFT_MIN_SPEED && !s.off) {
      s.drift = steer > 0 ? 1 : -1;
      s.charge = 0;
    }
  } else if (!driftHeld || v < P.DRIFT_MIN_SPEED * 0.7 || s.off) {
    if (!driftHeld && !s.off) {
      const mini = s.charge >= P.CHARGE_2 ? P.MINI_2 : s.charge >= P.CHARGE_1 ? P.MINI_1 : 0;
      if (mini > s.boost) s.boost = mini;
    }
    s.drift = 0;
    s.charge = 0;
  } else {
    s.charge += dt;
  }

  // --- Steering ---
  const speed = v < 0 ? -v : v;
  const grip = speed < P.TURN_FULL_SPEED ? speed / P.TURN_FULL_SPEED : 1;
  let rate;
  if (s.drift !== 0) rate = (s.drift * P.DRIFT_BASE + steer * P.DRIFT_STEER) * P.TURN_RATE * grip;
  else rate = steer * P.TURN_RATE * grip * (v < 0 ? -1 : 1);
  if (rate !== 0) rotateBy(s, rate * dt);

  // Sideways slide while drifting (outwards), decays otherwise.
  const slipTarget = s.drift !== 0 ? -s.drift * v * P.DRIFT_SLIP : 0;
  const k = P.SLIP_RESPONSE * dt < 1 ? P.SLIP_RESPONSE * dt : 1;
  s.vs += (slipTarget - s.vs) * k;

  // --- Move ---
  const nx = -s.hy;
  const ny = s.hx;
  s.x += (s.hx * v + nx * s.vs) * dt;
  s.y += (s.hy * v + ny * s.vs) * dt;

  // Boost pads
  for (let i = 0; i < track.pads.length; i++) {
    const pad = track.pads[i];
    const dx = s.x - pad.x;
    const dy = s.y - pad.y;
    if (dx * dx + dy * dy < P.PAD_RADIUS * P.PAD_RADIUS && s.boost < P.PAD_S) s.boost = P.PAD_S;
  }

  // Barriers + grass
  trackQuery(track, s.x, s.y, q);
  const limit = track.half + WALL_MARGIN - P.RADIUS;
  if (q.lateral > limit) {
    s.x -= q.nx * (q.lateral - limit);
    s.y -= q.ny * (q.lateral - limit);
    s.wall = 1;
  } else if (q.lateral < -limit) {
    s.x -= q.nx * (q.lateral + limit);
    s.y -= q.ny * (q.lateral + limit);
    s.wall = 1;
  }
  if (s.wall) {
    v *= P.WALL_DAMP;
    s.vs = 0;
  }
  s.off = q.lateral > track.half || q.lateral < -track.half ? 1 : 0;

  s.v = f(v);
  s.x = f(s.x);
  s.y = f(s.y);
  s.hx = f(s.hx);
  s.hy = f(s.hy);
  s.vs = f(s.vs);
  s.charge = f(s.charge);
  s.boost = f(s.boost);
  s.spin = f(s.spin);
}

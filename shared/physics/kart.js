// Kart physics for Turbo Kart GP. Runs on the server and on the client
// (prediction), so it is deterministic: only + - * / and Math.sqrt at
// runtime (rotations use a short Taylor series; the spin step is a literal)
// and every stored value is rounded to float32.
//
// Buttons: A = gas, B = drift (hold while steering, release for a mini
// turbo; tap in the air for a trick), X = use item. Stick: x = steer,
// up = gas, down = brake/reverse.
// Hills: going up lowers the top speed and gravity pulls you back, going
// down does the opposite. Barriers: a glancing hit costs little and turns
// you along the wall, a head-on hit costs a lot (and bounces you back).
// Jumps: a ramp (or a road that drops away faster than you can follow)
// sends you flying; a trick in the air gives a boost on landing. Where
// there is no barrier (or no road: a gap) you can fall off; you come back
// on the road a moment later.
import { BTN } from '../messages.js';
import { trackQuery, createTrackQuery, pointAt, FALL_EDGE } from '../maps/kart-tracks.js';
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
  STAR_S: 5,
  PAD_S: 0.9,
  PAD_RADIUS: 20,
  WALL_SCRAPE: 0.985, // speed kept per tick while sliding along a barrier
  WALL_LOSS: 0.6, // speed lost on a head-on hit (× impact², 0 for a glancing one)
  WALL_TURN: 0.6, // how much a hit turns you along the barrier
  WALL_BOUNCE_AT: 0.85, // impact (0..1) from which you bounce back …
  WALL_BOUNCE_MIN: 70, // … when going at least this fast
  WALL_BOUNCE: 0.25, // part of the speed you bounce back with
  SLOPE_G: 260, // gravity along the road (units/s² per unit of slope)
  SLOPE_TOP: 1.4, // top speed × (1 - this × slope): slower uphill, faster downhill
  SPIN_DAMP: 0.9,
  SPIN_COS: 0.9210609940028851, // 0.4 rad per tick while spinning out
  SPIN_SIN: 0.3894183423086505,
  GRAVITY: 330, // in the air (units/s²)
  AIR_STEER: 0.35, // steering left in the air
  AIR_DRAG: 0.12, // speed lost per second in the air
  RAMP_MIN_SPEED: 40,
  TRICK_BOOST: 0.85, // a trick in the air: this much boost on landing
  DROP_STEP: 2.2, // the road falls away more than this in one step: you fly off it
  FALL_S: 1.3, // falling off the track, until you are put back
  RESPAWN_BACK: 24, // put back this far behind where you fell
};

const f = Math.fround;
const q = createTrackQuery();

// Keeps (x, y) inside the barriers on this side (q = the query at (x, y)).
// True when it had to push. Sides without a barrier are left alone.
function pushInside(s, track, q2) {
  if (q2.wall < 0) return false;
  const limit = q2.half + q2.wall - KART_PHYS.RADIUS;
  const out = (q2.lateral < 0 ? -q2.lateral : q2.lateral) - limit;
  if (out <= 0) return false;
  s.x -= q2.ox * out;
  s.y -= q2.oy * out;
  return true;
}

// For the server after karts bumped into each other: back inside the barriers.
export function clampToTrack(s, track) {
  trackQuery(track, s.x, s.y, q, s.seg);
  if (!pushInside(s, track, q)) return false;
  s.x = f(s.x);
  s.y = f(s.y);
  return true;
}

export function createKartState() {
  return {
    x: 0, y: 0, hx: 1, hy: 0, v: 0, vs: 0, drift: 0, charge: 0, boost: 0, spin: 0, item: 0, prev: 0, off: 0,
    z: 0, vz: 0, seg: -1, fall: 0, trick: 0,
  };
}

export const KART_STATE_KEYS = ['x', 'y', 'hx', 'hy', 'v', 'vs', 'drift', 'charge', 'boost', 'spin', 'item', 'prev', 'off', 'z', 'vz', 'seg', 'fall', 'trick'];

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

// Back on the road after a fall: on the centre line a little behind, standing
// still; after a gap on the far side of it (you can not jump it from a standstill).
export function respawn(s, track) {
  let seg = s.seg < 0 ? 0 : s.seg;
  let back = KART_PHYS.RESPAWN_BACK;
  if (track.gap[seg]) {
    while (track.gap[seg]) seg = (seg + 1) % track.count;
    back = -KART_PHYS.RESPAWN_BACK;
  }
  const p = pointAt(track, track.cum[seg] - back);
  s.x = f(p.x);
  s.y = f(p.y);
  s.hx = f(p.tx);
  s.hy = f(p.ty);
  s.seg = p.seg;
  s.v = 0;
  s.vs = 0;
  s.z = 0;
  s.vz = 0;
  s.fall = 0;
  s.drift = 0;
  s.charge = 0;
  s.boost = 0;
  s.spin = 0;
  s.trick = 0;
  s.off = 0;
}

function round(s) {
  s.v = f(s.v);
  s.x = f(s.x);
  s.y = f(s.y);
  s.hx = f(s.hx);
  s.hy = f(s.hy);
  s.vs = f(s.vs);
  s.charge = f(s.charge);
  s.boost = f(s.boost);
  s.spin = f(s.spin);
  s.z = f(s.z);
  s.vz = f(s.vz);
  s.fall = f(s.fall);
}

// One fixed step. Sets s.fired (item to spawn, server only), s.wall (scraped
// a barrier this step), s.landed (touched down this step; 2 = after a trick)
// and s.fell (just started falling) as outputs; they are not part of the state.
export function stepKart(s, ax, ay, buttons, dt, track) {
  const P = KART_PHYS;
  const pressed = buttons & ~s.prev;
  s.prev = buttons;
  s.fired = 0;
  s.wall = 0;
  s.landed = 0;
  s.fell = 0;
  if (s.seg < 0) s.seg = trackQuery(track, s.x, s.y, q).seg;

  // Falling off the track: no control until you are put back.
  if (s.fall > 0) {
    s.fall = s.fall - dt > 0 ? s.fall - dt : 0;
    s.vz -= P.GRAVITY * dt;
    s.z += s.vz * dt;
    s.v *= 0.97;
    s.x += s.hx * s.v * dt;
    s.y += s.hy * s.v * dt;
    if (s.fall <= 0) respawn(s, track);
    round(s);
    return;
  }

  let steer = ax < -1 ? -1 : ax > 1 ? 1 : ax;
  const brake = ay > 0.5;
  let gas = !brake && ((buttons & BTN.A) !== 0 || ay < -0.5);
  const driftHeld = (buttons & BTN.B) !== 0;
  const air = s.z > 0 || s.vz > 0;

  if (pressed & BTN.X && s.item) {
    const item = s.item;
    if (item === ITEM.TURBO || item === ITEM.TURBO2 || item === ITEM.TURBO3) {
      // A triple turbo is used one at a time.
      s.boost = s.boost > P.TURBO_S ? s.boost : P.TURBO_S;
      s.item = item === ITEM.TURBO3 ? ITEM.TURBO2 : item === ITEM.TURBO2 ? ITEM.TURBO : 0;
    } else {
      // The superstar boosts right away (predicted); the server adds the invincibility.
      if (item === ITEM.STAR) s.boost = s.boost > P.STAR_S ? s.boost : P.STAR_S;
      s.fired = item;
      s.item = 0;
    }
  }
  if (air && pressed & BTN.B && !s.trick) s.trick = 1; // a trick in the air

  // The hill under the kart: > 0 when the nose points uphill.
  trackQuery(track, s.x, s.y, q, s.seg);
  const h0 = q.h;
  const seg0 = q.seg;
  const climb = air ? 0 : q.slope * (s.hx * track.tx[q.seg] + s.hy * track.ty[q.seg]);

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
  if (climb !== 0) {
    let k = 1 - P.SLOPE_TOP * climb;
    k = k < 0.75 ? 0.75 : k > 1.25 ? 1.25 : k;
    top *= k;
  }
  if (air) {
    v -= v * P.AIR_DRAG * dt; // no grip in the air
  } else if (gas) {
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
  if (!air && v > top) v = v - P.OVERSPEED_DECEL * dt > top ? v - P.OVERSPEED_DECEL * dt : top;
  v -= P.SLOPE_G * climb * dt; // gravity along the slope

  // --- Drift: hold B while steering at speed; release for a mini turbo ---
  if (s.drift === 0) {
    if (!air && driftHeld && s.spin <= 0 && (steer > 0.35 || steer < -0.35) && v > P.DRIFT_MIN_SPEED && !s.off) {
      s.drift = steer > 0 ? 1 : -1;
      s.charge = 0;
    }
  } else if (!driftHeld || v < P.DRIFT_MIN_SPEED * 0.7 || s.off) {
    if (!driftHeld && !s.off && !air) {
      const mini = s.charge >= P.CHARGE_2 ? P.MINI_2 : s.charge >= P.CHARGE_1 ? P.MINI_1 : 0;
      if (mini > s.boost) s.boost = mini;
    }
    s.drift = 0;
    s.charge = 0;
  } else if (!air) {
    s.charge += dt;
  }

  // --- Steering ---
  const speed = v < 0 ? -v : v;
  const grip = (speed < P.TURN_FULL_SPEED ? speed / P.TURN_FULL_SPEED : 1) * (air ? P.AIR_STEER : 1);
  let rate;
  if (s.drift !== 0) rate = (s.drift * P.DRIFT_BASE + steer * P.DRIFT_STEER) * P.TURN_RATE * grip;
  else rate = steer * P.TURN_RATE * grip * (v < 0 ? -1 : 1);
  if (rate !== 0) rotateBy(s, rate * dt);

  // Sideways slide while drifting (outwards), decays otherwise (also after a bump).
  const slipTarget = s.drift !== 0 ? -s.drift * v * P.DRIFT_SLIP : 0;
  const k = P.SLIP_RESPONSE * dt < 1 ? P.SLIP_RESPONSE * dt : 1;
  s.vs += (slipTarget - s.vs) * k;

  // --- Move ---
  const nx = -s.hy;
  const ny = s.hx;
  s.x += (s.hx * v + nx * s.vs) * dt;
  s.y += (s.hy * v + ny * s.vs) * dt;
  trackQuery(track, s.x, s.y, q, seg0);
  s.seg = q.seg;

  // --- Up and down: ramps, drops, landing ---
  if (air) {
    s.vz -= P.GRAVITY * dt;
    s.z += s.vz * dt - (q.h - h0); // the road under us moves up or down
    if (s.z <= 0) {
      s.z = 0;
      s.vz = 0;
      s.landed = s.trick ? 2 : 1;
      if (s.trick) s.boost = s.boost > P.TRICK_BOOST ? s.boost : P.TRICK_BOOST;
      s.trick = 0;
    }
  } else if (track.ramp[q.seg] > 0 && q.seg !== seg0 && v > P.RAMP_MIN_SPEED) {
    let k2 = v / P.MAX_SPEED;
    k2 = k2 < 0.5 ? 0.5 : k2 > 1.25 ? 1.25 : k2;
    s.vz = track.ramp[q.seg] * k2;
    s.z = 0.01;
    s.drift = 0;
    s.charge = 0;
  } else if (h0 - q.h > P.DROP_STEP) {
    // The road falls away under us: fly off it.
    s.z = h0 - q.h;
    s.vz = 0;
  }
  const flying = s.z > 0 || s.vz > 0;

  // Boost pads
  if (!flying) {
    for (let i = 0; i < track.pads.length; i++) {
      const pad = track.pads[i];
      const dx = s.x - pad.x;
      const dy = s.y - pad.y;
      if (dx * dx + dy * dy < P.PAD_RADIUS * P.PAD_RADIUS && s.boost < P.PAD_S) s.boost = P.PAD_S;
    }
  }

  // Barriers + grass (in the air too: you can not fly over a barrier)
  if (pushInside(s, track, q)) {
    s.wall = 1;
    // Impact: how much we drive into the barrier (0 = along it, 1 = head-on).
    const dirV = v < 0 ? -1 : 1;
    const into = (s.hx * q.ox + s.hy * q.oy) * dirV;
    if (into > 0) {
      if (v > 0) {
        // Turned along the wall, so you slide on instead of grinding to a halt.
        const tx = s.hx - q.ox * into * P.WALL_TURN;
        const ty = s.hy - q.oy * into * P.WALL_TURN;
        const len = Math.sqrt(tx * tx + ty * ty);
        if (len > 1e-6) {
          s.hx = tx / len;
          s.hy = ty / len;
        }
      }
      const spd = v < 0 ? -v : v; // at the moment of impact
      if (into > P.WALL_BOUNCE_AT && spd > P.WALL_BOUNCE_MIN) v = -v * P.WALL_BOUNCE;
      else v *= 1 - P.WALL_LOSS * into * into;
    } else {
      v *= P.WALL_SCRAPE;
    }
    s.vs = 0;
  }
  const lat = q.lateral < 0 ? -q.lateral : q.lateral;
  s.off = !flying && lat > q.half ? 1 : 0;
  // Off the edge where there is no barrier, or on a gap without flying: fall.
  if (!flying && ((q.wall < 0 && lat > q.half + FALL_EDGE) || q.gap)) {
    s.fall = P.FALL_S;
    s.fell = 1;
    s.vz = 0;
    s.z = 0;
    s.drift = 0;
    s.charge = 0;
    s.off = 0;
  }
  s.v = v;
  round(s);
}

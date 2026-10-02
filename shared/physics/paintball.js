// Spetterveld movement and 3D line tests. Runs on the server (authoritative)
// and on the client (prediction), so it is deterministic: only + - * / and
// Math.sqrt, every stored value through Math.fround (float32 like the snapshot).
//
// The world is a level { width, height, solids }: solids are boxes
// { t: 'box', x, y, w, h, z0, z1 } (centre, size, bottom and top) or upright
// cylinders { t: 'can', x, y, r, z0, z1 }. Game (x, y) is the ground plane,
// z is up. A runner walks up anything up to STEP high (stairs, kerbs), falls
// off edges, jumps (onto crates), bumps its head on ceilings and can crouch
// or lie down (smaller and slower; standing up needs room above).
// Buttons (shared/messages.js BTN): X = jump (held); a press of Y cycles
// stand → crouch → lie down → stand (Shift), R toggles crouching (C) and L
// lying down (Z); jumping stands you up first.
// The wish direction (ax, ay) is already in world space: the client turns
// "forward/strafe + view angle" into it before quantizing and sending.
import { BTN } from '../messages.js';

export const PB_PHYS = {
  DT: 1 / 30,
  RADIUS: 4, // body (collision)
  HIT_RADIUS: 5.2, // a little generous for shots
  HEIGHT: 17, // top of the head above the feet
  SPEED: 50,
  SPRINT: 1.4, // speed factor with the sprint power-up (s.boost > 0)
  ACCEL: 420, // per second, towards the wish velocity (on the ground)
  AIR_ACCEL: 150, // … and in the air
  GRAVITY: 260,
  JUMP: 72, // take-off speed: about 10 high
  STEP: 3.4, // walk up anything this high without jumping
  SNAP: 4.5, // walking down: stay on the ground over drops this small
  EYE: 15, // eye height
  GUN: 13, // the marker, where the paint leaves (for the looks)
};
// Standing, crouching (bukken) and lying down (liggen).
export const PB_STANCE = { STAND: 0, CROUCH: 1, PRONE: 2 };
const STANCES = [
  { height: 17, eye: 15, speed: 1, hit: 5.2 },
  { height: 11, eye: 9.5, speed: 0.55, hit: 5.2 },
  { height: 5.5, eye: 4, speed: 0.3, hit: 6.8 }, // lying: low but long, so a wider hit volume
];
export const bodyHeight = (stance) => STANCES[stance | 0].height;
export const eyeHeight = (stance) => STANCES[stance | 0].eye;
// A jump reaches its top at JUMP² / 2G; with the step on top of that this is the highest edge you can climb.
export const JUMP_REACH = (PB_PHYS.JUMP * PB_PHYS.JUMP) / (2 * PB_PHYS.GRAVITY) + PB_PHYS.STEP - 0.5;

const f = Math.fround;
const EPS = 1e-4;
const rayNormal = { x: 0, y: 0, z: 0 };

export function createRunner(x = 0, y = 0, z = 0) {
  return { x, y, z, vx: 0, vy: 0, vz: 0, boost: 0, ground: 1, stance: 0, prev: 0 };
}

// The buttons that matter for the runner (and are remembered in s.prev for the toggles).
export const RUNNER_BUTTONS = BTN.X | BTN.Y | BTN.L | BTN.R;

// One tick. buttons: BTN.X held = jump (again as soon as you land); a press
// of BTN.Y cycles the stance, BTN.R / BTN.L toggle crouching / lying down.
export function stepRunner(s, ax, ay, buttons, dt, level) {
  const P = PB_PHYS;
  const held = buttons & RUNNER_BUTTONS;
  const pressed = held & ~s.prev;
  s.prev = held;
  // Change stance (on the ground only). Getting up needs room above: from
  // lying down you may only get as far as crouching under a low ceiling.
  let jump = (held & BTN.X) !== 0;
  if (s.ground) {
    let want = s.stance;
    if (pressed & BTN.Y) want = s.stance === PB_STANCE.PRONE ? PB_STANCE.STAND : s.stance + 1;
    if (pressed & BTN.R) want = s.stance === PB_STANCE.CROUCH ? PB_STANCE.STAND : PB_STANCE.CROUCH;
    if (pressed & BTN.L) want = s.stance === PB_STANCE.PRONE ? PB_STANCE.STAND : PB_STANCE.PRONE;
    if (pressed & BTN.X && s.stance !== PB_STANCE.STAND) want = PB_STANCE.STAND;
    if (s.stance !== PB_STANCE.STAND) jump = false; // first get up
    if (want < s.stance) {
      const room = ceilingHeight(level, s.x, s.y, P.RADIUS - 0.5, s.z + bodyHeight(s.stance)) - s.z;
      while (want < s.stance && bodyHeight(want) > room + EPS) want++;
    }
    s.stance = want;
  }
  const st = STANCES[s.stance];
  const speed = (s.boost > 0 ? P.SPEED * P.SPRINT : P.SPEED) * st.speed;
  if (s.boost > 0) s.boost = f(s.boost - dt > 0 ? s.boost - dt : 0);
  let dvx = ax * speed - s.vx;
  let dvy = ay * speed - s.vy;
  const len = Math.sqrt(dvx * dvx + dvy * dvy);
  const max = (s.ground ? P.ACCEL : P.AIR_ACCEL) * dt;
  if (len > max) {
    dvx = (dvx / len) * max;
    dvy = (dvy / len) * max;
  }
  s.vx = f(s.vx + dvx);
  s.vy = f(s.vy + dvy);
  if (jump && s.ground) {
    s.vz = P.JUMP;
    s.ground = 0;
  }
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  collide(s, level, P.RADIUS);

  // Up and down: gravity, ceilings, landing, walking down steps.
  const z0 = s.z;
  const floor = groundHeight(level, s.x, s.y, P.RADIUS - 0.5, z0 + P.STEP);
  let vz = s.vz - P.GRAVITY * dt;
  let z = z0 + vz * dt;
  if (vz > 0) {
    const ceil = ceilingHeight(level, s.x, s.y, P.RADIUS - 0.5, z0 + st.height);
    if (z + st.height > ceil) {
      z = ceil - st.height;
      vz = 0;
    }
  }
  if (z <= floor || (s.ground && vz <= 0 && z - floor <= P.SNAP)) {
    z = floor;
    vz = 0;
    s.ground = 1;
  } else s.ground = 0;
  s.z = f(z);
  s.vz = f(vz);
  s.x = f(s.x);
  s.y = f(s.y);
}

// Does the solid overlap the circle (x, y, r) seen from above?
export function overlaps(o, x, y, r) {
  if (o.t === 'can') {
    const dx = x - o.x;
    const dy = y - o.y;
    const m = o.r + r;
    return dx * dx + dy * dy < m * m;
  }
  const hw = o.w / 2;
  const hh = o.h / 2;
  const cx = x < o.x - hw ? o.x - hw : x > o.x + hw ? o.x + hw : x;
  const cy = y < o.y - hh ? o.y - hh : y > o.y + hh ? o.y + hh : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy < r * r;
}

// The highest top at or below zMax under the circle (0 = the field itself).
export function groundHeight(level, x, y, r, zMax) {
  let best = 0;
  const list = level.solids;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (o.z1 > zMax + EPS || o.z1 <= best || !overlaps(o, x, y, r)) continue;
    best = o.z1;
  }
  return best;
}

// The lowest bottom at or above zMin over the circle (Infinity = open sky).
export function ceilingHeight(level, x, y, r, zMin) {
  let best = Infinity;
  const list = level.solids;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (o.z0 < zMin - EPS || o.z0 >= best || !overlaps(o, x, y, r)) continue;
    best = o.z0;
  }
  return best;
}

// Push a body standing at s.z out of every solid it bumps into (sideways)
// and keep it inside the field. Solids up to STEP above the feet are steps
// (the vertical pass puts us on top), solids above the head are ceilings.
export function collide(s, level, r) {
  const list = level.solids;
  const lo = (s.z ?? 0) + PB_PHYS.STEP;
  const hi = (s.z ?? 0) + bodyHeight(s.stance ?? 0);
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (o.z1 <= lo || o.z0 >= hi) continue;
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
  if (s.x > level.width - r) s.x = level.width - r;
  if (s.y < r) s.y = r;
  if (s.y > level.height - r) s.y = level.height - r;
}

// Is there room to stand at (x, y, z) (nothing in the way of the body)?
export function standsFree(level, x, y, z, r = PB_PHYS.RADIUS) {
  if (x < r || y < r || x > level.width - r || y > level.height - r) return false;
  for (const o of level.solids) {
    if (o.z1 > z + 0.01 && o.z0 < z + PB_PHYS.HEIGHT && overlaps(o, x, y, r)) return false;
  }
  return true;
}

// --- Rays (shots, line of sight) --------------------------------------------------------------
// A unit direction from a view angle (yaw, around z) and pitch (up > 0).
export function aimDir(yaw, pitch, out) {
  const c = Math.cos(pitch);
  out.x = Math.cos(yaw) * c;
  out.y = Math.sin(yaw) * c;
  out.z = Math.sin(pitch);
  return out;
}

// Slab test state (module level: no allocations per ray).
let tMin = 0;
let tMax = 0;
let sNx = 0;
let sNy = 0;
let sNz = 0;
function slab(org, d, lo, hi, k) {
  if (Math.abs(d) < 1e-9) return org >= lo && org <= hi;
  let t1 = (lo - org) / d;
  let t2 = (hi - org) / d;
  let side = -1;
  if (t1 > t2) {
    const t = t1;
    t1 = t2;
    t2 = t;
    side = 1;
  }
  if (t1 > tMin) {
    tMin = t1;
    sNx = k === 0 ? side : 0;
    sNy = k === 1 ? side : 0;
    sNz = k === 2 ? side : 0;
  }
  if (t2 < tMax) tMax = t2;
  return true;
}

// Distance along the unit ray to an axis-aligned box {x, y, w, h, z0, z1}
// (slab test), or Infinity. Writes the face normal into n.
export function rayBox(ox, oy, oz, dx, dy, dz, o, n = null) {
  tMin = -Infinity;
  tMax = Infinity;
  sNx = sNy = sNz = 0;
  if (!slab(ox, dx, o.x - o.w / 2, o.x + o.w / 2, 0)) return Infinity;
  if (!slab(oy, dy, o.y - o.h / 2, o.y + o.h / 2, 1)) return Infinity;
  if (!slab(oz, dz, o.z0, o.z1, 2)) return Infinity;
  if (tMax < tMin || tMax < 0) return Infinity;
  if (n) {
    n.x = sNx;
    n.y = sNy;
    n.z = sNz;
  }
  return tMin > 0 ? tMin : 0;
}

// Distance along the unit ray to an upright cylinder (centre cx, cy, radius r,
// from z0 to z1), or Infinity. Writes the normal into n.
export function rayCylinder(ox, oy, oz, dx, dy, dz, cx, cy, r, z0, z1, n = null) {
  // Where the ray is inside the circle (seen from above)…
  const px = ox - cx;
  const py = oy - cy;
  const a = dx * dx + dy * dy;
  let tin;
  let tout;
  let side = true;
  if (a < 1e-12) {
    if (px * px + py * py > r * r) return Infinity;
    tin = -Infinity;
    tout = Infinity;
  } else {
    const b = px * dx + py * dy;
    const c = px * px + py * py - r * r;
    const disc = b * b - a * c;
    if (disc < 0) return Infinity;
    const sq = Math.sqrt(disc);
    tin = (-b - sq) / a;
    tout = (-b + sq) / a;
  }
  // … and between the bottom and the top.
  if (Math.abs(dz) < 1e-9) {
    if (oz < z0 || oz > z1) return Infinity;
  } else {
    let t1 = (z0 - oz) / dz;
    let t2 = (z1 - oz) / dz;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    if (t1 > tin) {
      tin = t1;
      side = false;
    }
    if (t2 < tout) tout = t2;
  }
  if (tout < tin || tout < 0) return Infinity;
  const t = tin > 0 ? tin : 0;
  if (n) {
    if (side) {
      const hx = px + dx * t;
      const hy = py + dy * t;
      const l = Math.sqrt(hx * hx + hy * hy) || 1;
      n.x = hx / l;
      n.y = hy / l;
      n.z = 0;
    } else {
      n.x = 0;
      n.y = 0;
      n.z = dz > 0 ? -1 : 1;
    }
  }
  return t;
}

// A player's hit volume: an upright cylinder from the feet to just over the
// head (lower and a little wider when lying down).
export function rayPlayer(ox, oy, oz, dx, dy, dz, px, py, pz, stance = 0) {
  const st = STANCES[stance | 0];
  return rayCylinder(ox, oy, oz, dx, dy, dz, px, py, st.hit, pz, pz + st.height + 1);
}

// First solid, the ground or the field edge along the ray. Returns the
// distance; hit.nx/ny/nz = surface normal, hit.solid = index
// (-1 = field edge, -2 = the ground, -3 = nothing within maxDist).
export function raycast(level, ox, oy, oz, dx, dy, dz, maxDist, hit = {}) {
  let best = maxDist;
  let bi = -3;
  const n = rayNormal;
  hit.nx = 0;
  hit.ny = 0;
  hit.nz = 0;
  const list = level.solids;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    const t = o.t === 'can'
      ? rayCylinder(ox, oy, oz, dx, dy, dz, o.x, o.y, o.r, o.z0, o.z1, n)
      : rayBox(ox, oy, oz, dx, dy, dz, o, n);
    if (t < best) {
      best = t;
      bi = i;
      hit.nx = n.x;
      hit.ny = n.y;
      hit.nz = n.z;
    }
  }
  if (dz < 0) {
    const t = -oz / dz;
    if (t < best) {
      best = t;
      bi = -2;
      hit.nx = 0;
      hit.ny = 0;
      hit.nz = 1;
    }
  }
  // Field edge (the net).
  const ex = dx > 0 ? (level.width - ox) / dx : dx < 0 ? -ox / dx : Infinity;
  const ey = dy > 0 ? (level.height - oy) / dy : dy < 0 ? -oy / dy : Infinity;
  if (ex < best) {
    best = ex;
    bi = -1;
    hit.nx = dx > 0 ? -1 : 1;
    hit.ny = 0;
    hit.nz = 0;
  }
  if (ey < best) {
    best = ey;
    bi = -1;
    hit.nx = 0;
    hit.ny = dy > 0 ? -1 : 1;
    hit.nz = 0;
  }
  hit.solid = bi;
  return best;
}

// Can a ball get from (x0, y0, z0) to (x1, y1, z1)?
export function lineOfSight(level, x0, y0, z0, x1, y1, z1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 1e-6) return true;
  return raycast(level, x0, y0, z0, dx / d, dy / d, dz / d, d) >= d - 0.01;
}

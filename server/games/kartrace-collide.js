// Turbo Kart GP: karts bumping into each other (server only). Every kart has
// already driven this tick (maybe more than one input); the paths are
// replayed in small sub-steps so fast karts can not pass through each other.
// A bump is a real collision: the karts push apart and trade momentum along
// the contact line, so a side bump shoves you sideways (it fades out through
// the physics' sideways slide) and a hit from behind pushes you forward. A
// superstar is heavy. Karts on different levels (a bridge, a jump) do not
// touch. A kart that did not bump ends exactly where its own physics put it,
// so the owner's prediction stays spot on.
import { clampToTrack } from '../../shared/physics/kart.js';
import { trackQuery, createTrackQuery } from '../../shared/maps/kart-tracks.js';
import { KART_RULES as R } from '../../shared/games/kartrace.js';

const MAX_SUBSTEPS = 6;
const RESTITUTION = 0.35;
const STAR_MASS = 4;
const LEVEL_GAP = 12; // height difference at which two karts pass above each other
const MAX_SIDE_SPEED = 90; // a bump never slings you sideways faster than this
const f = Math.fround;
const q = createTrackQuery();

// Absolute height of a kart (road + jump).
function heightOf(k, track) {
  return trackQuery(track, k.s.x, k.s.y, q, k.s.seg).h + k.s.z;
}

// karts: every kart in the race (finished ones too: they still drive around).
// onBump(a, b, impact): after a bump with impact speed along the normal.
export function collideKarts(karts, track, dt, onBump) {
  const n = karts.length;
  if (n < 2) return;
  const min = R.BUMP_RADIUS * 2;
  let maxMove = 0;
  for (const k of karts) {
    maxMove = Math.max(maxMove, Math.hypot(k.s.x - k.px, k.s.y - k.py));
    k.endX = k.s.x;
    k.endY = k.s.y;
    k.bumped = false;
    k.alt = heightOf(k, track);
  }
  const steps = Math.max(1, Math.min(MAX_SUBSTEPS, Math.ceil((maxMove * 2) / (R.BUMP_RADIUS * 0.75))));
  for (const k of karts) {
    k.stepX = (k.s.x - k.px) / steps;
    k.stepY = (k.s.y - k.py) / steps;
    k.s.x = k.px;
    k.s.y = k.py;
  }
  for (let st = 0; st < steps; st++) {
    for (const k of karts) {
      k.s.x += k.stepX;
      k.s.y += k.stepY;
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = karts[i];
        const b = karts[j];
        if (a.s.fall > 0 || b.s.fall > 0 || Math.abs(a.alt - b.alt) > LEVEL_GAP) continue;
        const dx = b.s.x - a.s.x;
        const dy = b.s.y - a.s.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2);
        const nx = d > 1e-6 ? dx / d : -a.s.hy;
        const ny = d > 1e-6 ? dy / d : a.s.hx;
        const impact = resolve(a, b, nx, ny, min - d);
        a.bumped = b.bumped = true;
        onBump(a, b, impact);
        // From here on they follow their new velocity.
        for (const k of [a, b]) {
          const s = k.s;
          k.stepX = ((s.hx * s.v - s.hy * s.vs) * dt) / steps;
          k.stepY = ((s.hy * s.v + s.hx * s.vs) * dt) / steps;
        }
      }
    }
  }
  for (const k of karts) {
    if (!k.bumped) {
      k.s.x = k.endX;
      k.s.y = k.endY;
      continue;
    }
    k.s.x = f(k.s.x);
    k.s.y = f(k.s.y);
    clampToTrack(k.s, track);
    k.s.seg = trackQuery(track, k.s.x, k.s.y, q, k.s.seg).seg;
  }
}

// Push apart and trade momentum along (nx, ny) (from a to b). Returns the impact speed.
function resolve(ka, kb, nx, ny, overlap) {
  const a = ka.s;
  const b = kb.s;
  const ma = ka.star > 0 ? STAR_MASS : 1;
  const mb = kb.star > 0 ? STAR_MASS : 1;
  a.x -= nx * overlap * (mb / (ma + mb));
  a.y -= ny * overlap * (mb / (ma + mb));
  b.x += nx * overlap * (ma / (ma + mb));
  b.y += ny * overlap * (ma / (ma + mb));
  // World velocities from speed along the heading + the sideways slide.
  const avx = a.hx * a.v - a.hy * a.vs;
  const avy = a.hy * a.v + a.hx * a.vs;
  const bvx = b.hx * b.v - b.hy * b.vs;
  const bvy = b.hy * b.v + b.hx * b.vs;
  const rel = (avx - bvx) * nx + (avy - bvy) * ny;
  if (rel <= 0) return 0; // already moving apart
  const jimp = ((1 + RESTITUTION) * rel) / (1 / ma + 1 / mb);
  setVelocity(a, avx - (jimp / ma) * nx, avy - (jimp / ma) * ny);
  setVelocity(b, bvx + (jimp / mb) * nx, bvy + (jimp / mb) * ny);
  return rel;
}

// Back from a world velocity to speed along the heading + sideways slide.
function setVelocity(s, vx, vy) {
  s.v = f(vx * s.hx + vy * s.hy);
  let side = -vx * s.hy + vy * s.hx;
  if (side > MAX_SIDE_SPEED) side = MAX_SIDE_SPEED;
  if (side < -MAX_SIDE_SPEED) side = -MAX_SIDE_SPEED;
  s.vs = f(side);
  s.drift = s.drift && Math.abs(side) > 60 ? 0 : s.drift; // a hard shove ends your drift
}

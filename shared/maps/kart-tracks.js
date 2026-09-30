// Turbo Kart GP circuits. A track is a closed Catmull-Rom spline through
// control points, sampled into a polyline (the "centre line"), with per
// sample: road width, barrier distance on each side (or none: a drop-off),
// height (hills, bridges) and jump ramps. Sampling uses only + - * / and
// Math.sqrt, rounded to float32, so the server and every client build exactly
// the same track (the kart physics depends on it).
//
// The physics looks for the closest bit of centre line NEAR the segment the
// kart was on (a hint in its state), so a track may cross itself on a bridge
// or run past itself behind a barrier. Rules for a new track (checked by
// test/kartrace.test.js): parts of the road that come close are separated by
// barriers or by enough height, the start/finish straight is flat at height
// 0, slopes stay gentle (except the drop right after a jump) and no corner is
// tighter than the barriers.
import { CLASSIC_TRACKS } from './kart-track-defs.js';
import { BIG_TRACKS } from './kart-track-defs-big.js';

const f = Math.fround;
const DEFS = { ...CLASSIC_TRACKS, ...BIG_TRACKS };

export const KART_TRACK_IDS = Object.keys(DEFS);
// Grand Prix cups (setting value → tracks).
export const KART_CUPS = {
  gp: ['ring', 'park', 'boulevard'],
  gphills: ['alpine', 'canyon', 'volcano'],
  gpgroot: ['harbour', 'jungle', 'summit', 'clouds'],
};
export const MAX_SLOPE = 0.2; // steepest allowed road (height per unit along the track)
export const WALL_MARGIN = 26; // default barrier distance beyond the road edge (grass in between)
export const NO_WALL = -1; // no barrier on that side: drive off and you fall
export const FALL_EDGE = 8; // how far past the road edge a kart can go before it falls
export const JUMP_ZONE = 320; // after a ramp the road may drop steeply this far (you are in the air)
const SPACING = 12; // target distance between samples
const SEARCH = 14; // segments searched either way from the kart's last segment

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

// Value of a step profile [[fraction, …values]] at a fraction.
function stepValue(profile, frac, k) {
  let v = profile[0][k];
  for (const row of profile) if (row[0] <= frac) v = row[k];
  return v;
}

function build(id) {
  const def = DEFS[id];
  const P = def.points;
  const n = P.length;
  const xs = [];
  const ys = [];
  const ws = [];
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n];
    const p1 = P[i];
    const p2 = P[(i + 1) % n];
    const p3 = P[(i + 2) % n];
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const w1 = p1[2] ?? def.width;
    const w2 = p2[2] ?? def.width;
    const steps = Math.max(2, Math.ceil(Math.sqrt(dx * dx + dy * dy) / SPACING));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      xs.push(f(catmull(p0[0], p1[0], p2[0], p3[0], t)));
      ys.push(f(catmull(p0[1], p1[1], p2[1], p3[1], t)));
      ws.push(f(w1 + (w2 - w1) * t));
    }
  }
  const count = xs.length;
  const px = new Float32Array(xs);
  const py = new Float32Array(ys);
  const hw = new Float32Array(ws.map((w) => f(w / 2))); // half road width per sample
  const tx = new Float32Array(count); // unit direction of segment i → i+1
  const ty = new Float32Array(count);
  const seglen = new Float32Array(count);
  const cum = new Float64Array(count + 1); // distance at the start of segment i
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    const dx = px[j] - px[i];
    const dy = py[j] - py[i];
    const len = Math.sqrt(dx * dx + dy * dy);
    tx[i] = f(dx / len);
    ty[i] = f(dy / len);
    seglen[i] = f(len);
    cum[i + 1] = cum[i] + seglen[i];
  }
  const length = cum[count];

  // Height per sample and the slope of each segment (0 without a profile).
  const pz = new Float32Array(count);
  const slope = new Float32Array(count);
  if (def.heights) {
    const H = def.heights;
    let k = 0;
    for (let i = 0; i < count; i++) {
      const frac = cum[i] / length;
      while (k < H.length - 2 && frac > H[k + 1][0]) k++;
      const [f0, h0] = H[k];
      const [f1, h1] = H[k + 1];
      const u = f1 > f0 ? (frac - f0) / (f1 - f0) : 0;
      const e = u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
      pz[i] = f(h0 + (h1 - h0) * e);
    }
    for (let i = 0; i < count; i++) slope[i] = f((pz[(i + 1) % count] - pz[i]) / seglen[i]);
  }

  // Barriers per side (step profile [[fraction, left, right]]) and jump ramps.
  const walls = def.walls ?? [[0, WALL_MARGIN, WALL_MARGIN]];
  const wl = new Float32Array(count);
  const wr = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const frac = cum[i] / length;
    wl[i] = stepValue(walls, frac, 1);
    wr[i] = stepValue(walls, frac, 2);
  }
  const ramp = new Float32Array(count); // launch speed when a kart drives onto this segment
  const segAt = (d) => {
    let i = 0;
    while (i < count - 1 && cum[i + 1] <= d) i++;
    return i;
  };
  for (const [frac, launch] of def.ramps ?? []) ramp[segAt(frac * length)] = launch;
  const gap = new Uint8Array(count); // 1 = no road here: you have to jump it
  for (const [f0, f1] of def.gaps ?? []) for (let i = segAt(f0 * length); i <= segAt(f1 * length); i++) gap[i] = 1;

  const track = {
    id, name: def.name, width: def.width, half: def.width / 2, count, px, py, tx, ty, seglen, cum, length, pz, slope,
    hw, wl, wr, ramp, gap,
    hilly: !!def.heights,
    big: !!def.big,
    theme: def.theme,
    boxes: [], pads: [], grid: [], ramps: [],
  };
  // Item boxes: rows of 4 across the road.
  for (const frac of def.items) {
    const at = pointAt(track, frac * length);
    for (let k = 0; k < 4; k++) {
      const lat = (k - 1.5) * ((at.half * 2) / 4.6);
      track.boxes.push({ x: f(at.x - at.ty * lat), y: f(at.y + at.tx * lat), seg: at.seg });
    }
  }
  for (const [frac, lat] of def.pads) {
    const at = pointAt(track, frac * length);
    track.pads.push({ x: f(at.x - at.ty * lat * at.half), y: f(at.y + at.tx * lat * at.half), dx: at.tx, dy: at.ty, seg: at.seg });
  }
  for (let i = 0; i < count; i++) if (ramp[i] > 0) track.ramps.push({ seg: i, launch: ramp[i], x: px[i], y: py[i], dx: tx[i], dy: ty[i] });
  // Starting grid: two columns behind the finish line (distance 0).
  for (let slot = 0; slot < 6; slot++) {
    const back = 26 + Math.floor(slot / 2) * 26 + (slot % 2) * 10;
    const at = pointAt(track, length - back);
    const lat = (slot % 2 ? 1 : -1) * at.half * 0.42;
    track.grid.push({ x: f(at.x - at.ty * lat), y: f(at.y + at.tx * lat), hx: at.tx, hy: at.ty, seg: at.seg });
  }
  return track;
}

// Point + direction at a distance along the centre line.
export function pointAt(track, d) {
  const L = track.length;
  d = ((d % L) + L) % L;
  let i = 0;
  let lo = 0;
  let hi = track.count - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (track.cum[mid] <= d) { i = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const t = (d - track.cum[i]) / track.seglen[i];
  const j = (i + 1) % track.count;
  return {
    x: track.px[i] + track.tx[i] * track.seglen[i] * t,
    y: track.py[i] + track.ty[i] * track.seglen[i] * t,
    tx: track.tx[i], ty: track.ty[i], seg: i,
    half: track.hw[i] + (track.hw[j] - track.hw[i]) * t,
    h: track.pz[i] + (track.pz[j] - track.pz[i]) * t,
  };
}

// Road height at a distance along the centre line.
export function heightAt(track, d) {
  return pointAt(track, d).h;
}

// Closest point on the centre line. Writes into out:
//   seg, t (distance along that segment), dist (along the lap),
//   lateral: signed distance to the centre line (> 0: right of the driving direction),
//   nx, ny: the segment's right-hand normal, ox, oy: unit direction from the
//   closest point to (x, y) (points outwards: the way to push back is -o),
//   h: road height there, slope: the segment's slope, half: half road width
//   there, wall: the barrier distance on the side of (x, y) (NO_WALL = none).
// hint: the segment the kart was on (searches only around it, so the road
// can cross itself); -1 = search the whole track.
export function trackQuery(track, x, y, out, hint = -1) {
  const { px, py, tx, ty, seglen, count } = track;
  let best = Infinity;
  let bi = 0;
  let bt = 0;
  const from = hint >= 0 ? hint - SEARCH : 0;
  const n = hint >= 0 ? Math.min(count, SEARCH * 2 + 1) : count;
  for (let k = 0; k < n; k++) {
    const i = hint >= 0 ? (from + k + count) % count : k;
    const ax = x - px[i];
    const ay = y - py[i];
    let t = ax * tx[i] + ay * ty[i];
    if (t < 0) t = 0;
    else if (t > seglen[i]) t = seglen[i];
    const dx = ax - tx[i] * t;
    const dy = ay - ty[i] * t;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) { best = d2; bi = i; bt = t; }
  }
  out.seg = bi;
  out.t = bt;
  out.dist = track.cum[bi] + bt;
  // Normal pointing to the right of the direction (y grows south).
  out.nx = -ty[bi];
  out.ny = tx[bi];
  // The true distance (also right at a joint between two segments, where the
  // segment's normal would underestimate it: walls in bends).
  const ox = x - (px[bi] + tx[bi] * bt);
  const oy = y - (py[bi] + ty[bi] * bt);
  const dist = Math.sqrt(best);
  const side = ox * out.nx + oy * out.ny;
  out.lateral = side < 0 ? -dist : dist;
  if (dist > 1e-6) {
    out.ox = ox / dist;
    out.oy = oy / dist;
  } else {
    out.ox = out.nx;
    out.oy = out.ny;
  }
  const j = bi + 1 < count ? bi + 1 : 0;
  const u = bt / seglen[bi];
  out.h = track.pz[bi] + (track.pz[j] - track.pz[bi]) * u;
  out.slope = track.slope[bi];
  out.half = track.hw[bi] + (track.hw[j] - track.hw[bi]) * u;
  out.wall = side < 0 ? track.wl[bi] : track.wr[bi];
  out.gap = track.gap[bi];
  return out;
}

export const createTrackQuery = () => ({ seg: 0, t: 0, dist: 0, lateral: 0, nx: 0, ny: 1, ox: 0, oy: 1, h: 0, slope: 0, half: 40, wall: WALL_MARGIN, gap: 0 });

export const KART_TRACKS = Object.fromEntries(KART_TRACK_IDS.map((id) => [id, build(id)]));

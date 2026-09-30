// Turbo Kart GP: the world around a track, in a single static mesh, styled
// by the track's theme (shared/maps/kart-track-defs*.js). A height field of
// rolling hills (it follows the road near the track: embankments on the
// hilly circuits; where the track crosses itself it follows the LOWER road,
// so the upper one becomes a bridge; a gorge under stretches without
// barriers, water under the gaps), a lake in the infield or the sea, a
// volcano, mountains on the horizon, then the road (road.js). Tracks in the
// clouds have no ground at all: a sea of clouds far below. Buildings, trees
// and track-side details come from scenery.js. Everything is seeded: same
// track, same world.
import { MeshBuilder } from '../../js/gl/mesh.js';
import { WALL_MARGIN, trackQuery, createTrackQuery } from '../../../shared/maps/kart-tracks.js';
import { addScenery } from './scenery.js';
import { buildRoad, ROAD_Y } from './road.js';

export { ROAD_Y };
export const WATER_Y = -3;
const CELL = 80; // terrain grid size
const FLAT = 1.5 * CELL; // terrain stays flat this far beyond the barriers (no hills over the road)
const RAMP = 460; // then rises to full hill height over this distance
const EMBANK = 150; // on hilly tracks the ground slopes from road height down to the hills over this distance
const SINK = 3; // … and stays this far below the road right beside it (the shoulder covers the gap)
const GORGE = 95; // how far the ground drops under a stretch without barriers
const CLOUD_Y = -160; // the sea of clouds under a track in the sky
const FOLLOW = 0.5; // the ground rises at most this steeply away from a road (steeper than any road)

function seeded(seed) {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export function buildWorld(t) {
  const b = new MeshBuilder();
  const th = t.theme;
  const rnd = seeded(t.count * 31 + t.id.length);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < t.count; i++) {
    minX = Math.min(minX, t.px[i]); maxX = Math.max(maxX, t.px[i]);
    minY = Math.min(minY, t.py[i]); maxY = Math.max(maxY, t.py[i]);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const size = Math.max(maxX - minX, maxY - minY) + 3400;
  const lim = t.half + WALL_MARGIN;
  // Beyond the barrier (or the road edge where there is none) at sample i on a side (-1 left, 1 right).
  const limAt = (i, side) => t.hw[i] + Math.max(8, side < 0 ? t.wl[i] : t.wr[i]);
  const seaY = th.sea ? maxY + 230 : Infinity; // the sea starts south of the track

  // Per sample: how far the road side reaches (barrier or road edge) and how
  // "open" (no barriers: a gorge below) or "gap" (water below) the stretch
  // is, faded in over a few samples so the gorge has sloping ends.
  const reachAt = (i) => t.hw[i] + Math.max(8, t.wl[i], t.wr[i]);
  const fade = (flag) => {
    const w = new Float32Array(t.count);
    for (let i = 0; i < t.count; i++) {
      if (!flag(i)) continue;
      let k = 1;
      while (k < 10 && flag((i + k) % t.count) && flag((i - k + t.count) % t.count)) k++;
      w[i] = smooth(k / 10);
    }
    return w;
  };
  const openW = fade((i) => t.wl[i] < 0 && t.wr[i] < 0);
  const gapW = fade((i) => t.gap[i] > 0);

  // Nearest centre-line sample: its distance and reach, and the height the
  // ground follows: the lowest of (road height + a slope up away from that
  // road), so where the track crosses itself the ground dips down to the lower
  // road and the upper one becomes a bridge over a little valley.
  const near = { d: 0, h: 0, lim: 0, open: 0, gap: 0 };
  const nearest = (x, y) => {
    let best = Infinity;
    let bi = 0;
    let low = Infinity;
    for (let i = 0; i < t.count; i += 2) {
      const dx = t.px[i] - x;
      const dy = t.py[i] - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) {
        best = d2;
        bi = i;
      }
      if (t.hilly) {
        const h = t.pz[i] + FOLLOW * Math.max(0, Math.sqrt(d2) - reachAt(i) - 10);
        if (h < low) low = h;
      }
    }
    near.d = Math.sqrt(best);
    near.h = t.hilly ? low : 0;
    near.lim = reachAt(bi);
    near.open = openW[bi];
    near.gap = Math.max(gapW[bi], gapW[(bi + 1) % t.count], gapW[(bi + t.count - 1) % t.count]);
    return near;
  };
  const distToTrack = (x, y) => nearest(x, y).d;

  // The infield spot farthest from the track: a lake there, or the volcano.
  let infield = { d: 0 };
  for (let y = minY; y <= maxY; y += 40) {
    for (let x = minX; x <= maxX; x += 40) {
      const d = distToTrack(x, y);
      if (d > infield.d) infield = { x, y, d };
    }
  }
  let lake = null;
  let volcano = null;
  if (th.volcano) {
    const r = infield.d - lim - 70;
    if (r > 80) volcano = { x: infield.x, y: infield.y, r: Math.min(r, 280) };
  } else if (!th.sea && !th.floating) {
    const r = infield.d - lim - 50;
    if (r > 60) lake = { x: infield.x, y: infield.y, r: Math.min(r, 230) };
  }

  const p = [rnd() * 6, rnd() * 6, rnd() * 6, rnd() * 6];
  const noise = (x, z) => 0.5 + 0.25 * Math.sin(x * 0.0031 + p[0]) * Math.cos(z * 0.0027 + p[1])
    + 0.15 * Math.sin((x + z) * 0.0071 + p[2]) + 0.1 * Math.cos((x - z) * 0.013 + p[3]);

  let hill = 0;
  const heightAt = (x, z) => {
    if (th.floating) return CLOUD_Y;
    const { d, h: road, lim: L, open, gap } = nearest(x, z);
    let h = smooth((d - L - FLAT) / RAMP) * (8 + th.hilly * noise(x, z));
    hill = h; // the natural hills only (for the snow line / rock colour)
    if (t.hilly) h += road * (1 - smooth((d - L - 10) / EMBANK)) - SINK * (1 - smooth((d - L) / 30));
    if (open) h -= open * GORGE * (1 - smooth((d - L - 60) / 260)); // a gorge under a bridge without barriers
    if (gap) h = Math.min(h, h + gap * (WATER_Y - 6 - h) * (1 - smooth((d - t.half - 40) / 80))); // water under a jump
    if (lake) {
      const r = Math.hypot(x - lake.x, z - lake.y);
      h = h * smooth((r - lake.r * 0.6) / 80) - 14 * (1 - smooth((r - lake.r * 0.4) / (lake.r * 0.7)));
    }
    if (z > seaY - 120) h = Math.min(h, (seaY - z) * 0.08); // the beach slopes into the sea
    return h;
  };

  if (th.floating) cloudSea(b, cx, cy, size / 2, rnd);
  else {
    // --- Terrain ---------------------------------------------------------------------------
    const n = Math.ceil(size / CELL);
    const gx0 = cx - (n * CELL) / 2;
    const gz0 = cy - (n * CELL) / 2;
    const H = new Float32Array((n + 1) * (n + 1));
    const HH = new Float32Array((n + 1) * (n + 1));
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        H[j * (n + 1) + i] = heightAt(gx0 + i * CELL, gz0 + j * CELL);
        HH[j * (n + 1) + i] = hill;
      }
    }
    const hillAt = (i, j) => HH[j * (n + 1) + i];
    const V = (i, j) => [gx0 + i * CELL, H[j * (n + 1) + i], gz0 + j * CELL];
    const shade = (h, hl, x, z) => {
      if (h < WATER_Y + 3) return th.shore;
      if (hl > th.hilly * 0.75) return th.high;
      return noise(x * 1.7, z * 1.7) > 0.52 ? th.ground[0] : th.ground[1];
    };
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = V(i, j), bb = V(i + 1, j), c = V(i + 1, j + 1), d = V(i, j + 1);
        const x = a[0] + CELL / 2;
        const z = a[2] + CELL / 2;
        const h1 = (hillAt(i, j) + hillAt(i + 1, j) + hillAt(i + 1, j + 1)) / 3;
        const h2 = (hillAt(i, j) + hillAt(i + 1, j + 1) + hillAt(i, j + 1)) / 3;
        b.color(shade((a[1] + bb[1] + c[1]) / 3, h1, x, z)).face([a, bb, c], [0, 1, 0]);
        b.color(shade((a[1] + c[1] + d[1]) / 3, h2, x - 20, z + 20)).face([a, c, d], [0, 1, 0]);
      }
    }
    // Water everywhere below the terrain: shows up in the lake and the sea.
    const half = (n * CELL) / 2;
    b.color(th.water, { emissive: 0.08 }).face([[cx - half, WATER_Y, cy - half], [cx - half, WATER_Y, cy + half], [cx + half, WATER_Y, cy + half], [cx + half, WATER_Y, cy - half]], [0, 1, 0]);
    if (th.sea) {
      b.color('#f4f4f4');
      for (let x = cx - half; x < cx + half; x += 70) {
        const z = seaY + 40 + rnd() * 30;
        b.face([[x, WATER_Y + 0.3, z], [x, WATER_Y + 0.3, z + 2], [x + 30, WATER_Y + 0.3, z + 2], [x + 30, WATER_Y + 0.3, z]], [0, 1, 0]);
      }
    }

    // --- Mountains on the horizon (snowy peaks, or dunes/cliffs at the coast) -----------------
    const ring = half - 120;
    const peaks = 34;
    for (let k = 0; k < peaks; k++) {
      const a = (k / peaks) * Math.PI * 2 + rnd() * 0.05;
      const mx = cx + Math.cos(a) * ring;
      const mz = cy + Math.sin(a) * ring;
      if (mz > seaY - 200) continue;
      const w = ((Math.PI * 2 * ring) / peaks) * (0.8 + rnd() * 0.6);
      const h = th.hilly * 1.4 + 120 + rnd() * 260;
      const tx = -Math.sin(a);
      const tz = Math.cos(a);
      const inward = [-Math.cos(a), 0.3, -Math.sin(a)];
      const L = [mx - tx * w / 2, -5, mz - tz * w / 2];
      const R = [mx + tx * w / 2, -5, mz + tz * w / 2];
      const top = [mx - Math.cos(a) * 30, h, mz - Math.sin(a) * 30];
      const [rock, snow] = th.mountain;
      if (!snow) {
        // Coast: low rounded cliffs instead of peaks.
        const steps = 5;
        const hh = h * 0.45;
        for (let s = 0; s < steps; s++) {
          const u0 = s / steps;
          const u1 = (s + 1) / steps;
          const P = (u, y) => [L[0] + (R[0] - L[0]) * u - Math.cos(a) * 30 * Math.sin(Math.PI * u), y, L[2] + (R[2] - L[2]) * u - Math.sin(a) * 30 * Math.sin(Math.PI * u)];
          b.color(rock).face([P(u0, -5), P(u1, -5), P(u1, hh * Math.sin(Math.PI * u1) ** 0.6), P(u0, hh * Math.sin(Math.PI * u0) ** 0.6)], inward);
        }
      } else if (h > 300) {
        const k2 = 0.72;
        const lerp3 = (u, v) => [u[0] + (v[0] - u[0]) * k2, u[1] + (v[1] - u[1]) * k2, u[2] + (v[2] - u[2]) * k2];
        const sl = lerp3(L, top);
        const sr = lerp3(R, top);
        b.color(rock).face([L, R, sr, sl], inward);
        b.color(snow).face([sl, sr, top], inward);
      } else {
        b.color(rock).face([L, R, top], inward);
      }
    }
  }

  buildRoad(b, t, th, th.floating ? null : heightAt);

  // Boost pads: painted chevrons pointing along the track.
  const q = createTrackQuery();
  const roadY = (x, z, seg) => trackQuery(t, x, z, q, seg).h + ROAD_Y + 0.05;
  for (const pad of t.pads) {
    const fx = pad.dx;
    const fy = pad.dy;
    const nx = -fy;
    const ny = fx;
    for (let k = 0; k < 3; k++) {
      const d = (k - 1) * 9;
      const P = (along, across) => {
        const x = pad.x + fx * along + nx * across;
        const z = pad.y + fy * along + ny * across;
        return [x, roadY(x, z, pad.seg), z];
      };
      const tip = P(d + 5, 0);
      const l = P(d - 3, 9);
      const rr = P(d - 3, -9);
      const mid = P(d, 0);
      b.color(k === 1 ? '#ff7a1a' : '#ffb020', { emissive: 0.35 }).face([tip, l, mid], [0, 1, 0]).face([tip, mid, rr], [0, 1, 0]);
    }
  }

  if (volcano) buildVolcano(b, volcano, th, rnd);
  addScenery(b, { t, th, rnd, lim, limAt, lake: lake ?? volcano, seaY, heightAt, distToTrack, ROAD_Y, bounds: { minX, maxX, minY, maxY } });
  return b.build();
}

// Far below a track in the sky: a flat sea of clouds with big puffs on it.
function cloudSea(b, cx, cy, half, rnd) {
  b.color('#f6eef8', { emissive: 0.25 }).face([[cx - half, CLOUD_Y, cy - half], [cx - half, CLOUD_Y, cy + half], [cx + half, CLOUD_Y, cy + half], [cx + half, CLOUD_Y, cy - half]], [0, 1, 0]);
  for (let k = 0; k < 90; k++) {
    const x = cx + (rnd() - 0.5) * half * 1.8;
    const z = cy + (rnd() - 0.5) * half * 1.8;
    const r = 40 + rnd() * 70;
    const c = rnd() < 0.5 ? '#ffffff' : '#f4e8f4';
    for (let p = 0; p < 3; p++) b.color(c, { emissive: 0.2 }).sphere(x + (p - 1) * r * 0.9, CLOUD_Y + r * (p === 1 ? 0.3 : 0.05), z + (rnd() - 0.5) * r, r * (p === 1 ? 1 : 0.75), 7, 4);
  }
}

// A low-poly volcano: rock bands, a glowing crater, lava streaks and a smoke plume.
function buildVolcano(b, v, th, rnd) {
  const segs = 14;
  const H = v.r * 1.05;
  const levels = [[1, -4], [0.72, H * 0.38], [0.45, H * 0.72], [0.24, H]];
  const ring = (k) => {
    const [f, y] = levels[k];
    return Array.from({ length: segs }, (_, i) => {
      const a = (i / segs) * Math.PI * 2;
      const wob = 1 + (k < 3 ? 0.08 * Math.sin(i * 2.7 + k) : 0);
      return [v.x + Math.cos(a) * v.r * f * wob, y, v.y + Math.sin(a) * v.r * f * wob];
    });
  };
  const rock = th.mountain[0];
  for (let k = 0; k < levels.length - 1; k++) {
    const lo = ring(k);
    const hi = ring(k + 1);
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      const out = [Math.cos(((i + 0.5) / segs) * Math.PI * 2), 0.6, Math.sin(((i + 0.5) / segs) * Math.PI * 2)];
      b.color(k % 2 ? rock : '#3a3232').face([lo[i], lo[j], hi[j], hi[i]], out);
    }
  }
  // Crater rim, lava lake and streaks down the side.
  const top = ring(levels.length - 1);
  b.color('#ff6a1a', { emissive: 1 }).face(top.map(([x, , z]) => [x, H - 3, z]), [0, 1, 0]);
  for (let s = 0; s < 4; s++) {
    const a = rnd() * Math.PI * 2;
    const w = 0.07;
    const P = (f, y, da) => [v.x + Math.cos(a + da) * v.r * f, y, v.y + Math.sin(a + da) * v.r * f];
    b.color('#ff8a2a', { emissive: 0.9 }).face([P(0.25, H - 0.5, -w), P(0.25, H - 0.5, w), P(0.62, H * 0.47, w * 0.4), P(0.62, H * 0.47, -w * 0.4)], [Math.cos(a), 0.7, Math.sin(a)]);
  }
  for (let k = 0; k < 5; k++) {
    b.color(k < 2 ? '#8a8480' : '#b8b2ac').sphere(v.x + (rnd() - 0.5) * 30 + k * 8, H + 22 + k * 26, v.y + (rnd() - 0.5) * 30, 16 + k * 7, 7, 4);
  }
}

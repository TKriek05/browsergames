// Turbo Kart GP: the world around a track, in a single static mesh, styled
// by the track's theme (shared/maps/kart-tracks.js). A height field of
// rolling hills (flat near the track, so the physics stays 2D), a lake in
// the infield or the sea, snowy mountains on the horizon, then the road
// with kerbs, lines, barriers and boost pads. Buildings, trees and track-side
// details come from scenery.js. Everything is seeded: same track, same world.
import { MeshBuilder } from '../../js/gl/mesh.js';
import { WALL_MARGIN } from '../../../shared/maps/kart-tracks.js';
import { addScenery } from './scenery.js';

export const ROAD_Y = 0.25;
export const WATER_Y = -3;
const BARRIER_H = 4.5;
const CELL = 80; // terrain grid size
const FLAT = 1.5 * CELL; // terrain stays flat this far beyond the barriers (no hills over the road)
const RAMP = 460; // then rises to full hill height over this distance

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
  const seaY = th.sea ? maxY + 230 : Infinity; // the sea starts south of the track

  const distToTrack = (x, y) => {
    let best = Infinity;
    for (let i = 0; i < t.count; i += 2) {
      const dx = t.px[i] - x;
      const dy = t.py[i] - y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };

  // A lake in the infield: the spot inside the bounding box farthest from the track.
  let lake = null;
  if (!th.sea) {
    let best = { d: 0 };
    for (let y = minY; y <= maxY; y += 40) {
      for (let x = minX; x <= maxX; x += 40) {
        const d = distToTrack(x, y);
        if (d > best.d) best = { x, y, d };
      }
    }
    const r = best.d - lim - 50;
    if (r > 60) lake = { x: best.x, y: best.y, r: Math.min(r, 230) };
  }

  const p = [rnd() * 6, rnd() * 6, rnd() * 6, rnd() * 6];
  const noise = (x, z) => 0.5 + 0.25 * Math.sin(x * 0.0031 + p[0]) * Math.cos(z * 0.0027 + p[1])
    + 0.15 * Math.sin((x + z) * 0.0071 + p[2]) + 0.1 * Math.cos((x - z) * 0.013 + p[3]);

  const heightAt = (x, z) => {
    const d = distToTrack(x, z);
    let h = smooth((d - lim - FLAT) / RAMP) * (8 + th.hilly * noise(x, z));
    if (lake) {
      const r = Math.hypot(x - lake.x, z - lake.y);
      h = h * smooth((r - lake.r * 0.6) / 80) - 14 * (1 - smooth((r - lake.r * 0.4) / (lake.r * 0.7)));
    }
    if (z > seaY - 120) h = Math.min(h, (seaY - z) * 0.08); // the beach slopes into the sea
    return h;
  };

  // --- Terrain ---------------------------------------------------------------------------
  const n = Math.ceil(size / CELL);
  const gx0 = cx - (n * CELL) / 2;
  const gz0 = cy - (n * CELL) / 2;
  const H = new Float32Array((n + 1) * (n + 1));
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) H[j * (n + 1) + i] = heightAt(gx0 + i * CELL, gz0 + j * CELL);
  const V = (i, j) => [gx0 + i * CELL, H[j * (n + 1) + i], gz0 + j * CELL];
  const shade = (h, x, z) => {
    if (h < WATER_Y + 3) return th.shore;
    if (h > th.hilly * 0.75) return th.high;
    return noise(x * 1.7, z * 1.7) > 0.52 ? th.ground[0] : th.ground[1];
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = V(i, j), bb = V(i + 1, j), c = V(i + 1, j + 1), d = V(i, j + 1);
      const x = a[0] + CELL / 2;
      const z = a[2] + CELL / 2;
      b.color(shade((a[1] + bb[1] + c[1]) / 3, x, z)).face([a, bb, c], [0, 1, 0]);
      b.color(shade((a[1] + c[1] + d[1]) / 3, x - 20, z + 20)).face([a, c, d], [0, 1, 0]);
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

  // --- Road: asphalt, white edge lines, kerbs, gravel, centre dashes -------------------------
  const edge = (off, y) => {
    const pts = [];
    for (let i = 0; i < t.count; i++) pts.push([t.px[i] - t.ty[i] * off, y, t.py[i] + t.tx[i] * off]);
    return pts;
  };
  const Lr = edge(-t.half, ROAD_Y);
  const Rr = edge(t.half, ROAD_Y);
  b.color(th.road[0]).ribbon(Lr, Rr, (i) => ((i >> 2) % 2 ? th.road[0] : th.road[1]), true);
  b.color('#f4f4f4');
  b.ribbon(edge(-t.half + 3.5, ROAD_Y + 0.02), edge(-t.half + 2, ROAD_Y + 0.02), null, true);
  b.ribbon(edge(t.half - 2, ROAD_Y + 0.02), edge(t.half - 3.5, ROAD_Y + 0.02), null, true);
  b.ribbon(edge(-t.half - 7, ROAD_Y), Lr, (i) => ((i >> 1) % 2 ? th.kerb[0] : th.kerb[1]), true);
  b.ribbon(Rr, edge(t.half + 7, ROAD_Y), (i) => ((i >> 1) % 2 ? th.kerb[0] : th.kerb[1]), true);
  b.color(th.edge);
  b.ribbon(edge(-t.half - 13, 0.12), edge(-t.half - 7, 0.12), null, true);
  b.ribbon(edge(t.half + 7, 0.12), edge(t.half + 13, 0.12), null, true);
  const dashL = edge(-0.9, ROAD_Y + 0.03);
  const dashR = edge(0.9, ROAD_Y + 0.03);
  b.color('#e8e8e8');
  for (let i = 0; i < t.count; i += 4) {
    const j = (i + 2) % t.count;
    b.face([dashL[i], dashR[i], dashR[j], dashL[j]], [0, 1, 0]);
  }

  // Barriers: low walls in alternating paint, with a cap on top.
  for (const side of [-1, 1]) {
    const line = edge(side * lim, 0).map(([x, , z]) => [x, z]);
    b.wall(line, 0, BARRIER_H, true, (i) => (Math.floor(i / 3) % 2 ? th.wall[0] : th.wall[1]));
    const inner = edge(side * (lim - 1), BARRIER_H);
    const outer = edge(side * (lim + 1), BARRIER_H);
    b.color(th.wall[1]);
    b.ribbon(side < 0 ? outer : inner, side < 0 ? inner : outer, null, true);
  }

  // Boost pads: painted chevrons pointing along the track.
  for (const pad of t.pads) {
    const fx = pad.dx;
    const fy = pad.dy;
    const nx = -fy;
    const ny = fx;
    for (let k = 0; k < 3; k++) {
      const d = (k - 1) * 9;
      const tip = [pad.x + fx * (d + 5), ROAD_Y + 0.05, pad.y + fy * (d + 5)];
      const l = [pad.x + fx * (d - 3) + nx * 9, ROAD_Y + 0.05, pad.y + fy * (d - 3) + ny * 9];
      const rr = [pad.x + fx * (d - 3) - nx * 9, ROAD_Y + 0.05, pad.y + fy * (d - 3) - ny * 9];
      const mid = [pad.x + fx * d, ROAD_Y + 0.05, pad.y + fy * d];
      b.color(k === 1 ? '#ff7a1a' : '#ffb020', { emissive: 0.35 }).face([tip, l, mid], [0, 1, 0]).face([tip, mid, rr], [0, 1, 0]);
    }
  }

  addScenery(b, { t, th, rnd, lim, lake, seaY, heightAt, distToTrack, ROAD_Y, bounds: { minX, maxX, minY, maxY } });
  return b.build();
}

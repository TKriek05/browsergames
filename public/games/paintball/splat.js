// Spetterveld paint splats as geometry: an irregular blob with a few spikes,
// loose droplets around it and, on walls, drips running down. Every splat
// has its own seed, so it keeps its shape when the mesh is rebuilt.
import { createRng } from '../../../shared/rng.js';

const POINTS = 14;

// s: { x, y, z, nx, nz, r, color, seed, floor, bend }
//   floor: lies on the ground; otherwise on a wall facing (nx, 0, nz).
//   bend: radius of a round wall (0 = flat), so the edges do not sink in.
export function addSplat(b, s, emissive = 0) {
  const rnd = createRng(s.seed);
  const off = s.floor ? 0 : 0.12 + (s.bend ? (s.r * s.r * 1.6) / (2 * s.bend) : 0);
  // Map (u, v) on the surface to 3D.
  const P = s.floor
    ? (u, v) => [s.x + u, 0.05 + (s.seed % 7) * 0.004, s.z + v]
    : (u, v) => [s.x - s.nz * u + s.nx * off, s.y + v, s.z + s.nx * u + s.nz * off];
  const n = s.floor ? [0, 1, 0] : [s.nx, 0, s.nz];
  b.color(s.color, { emissive });
  blob(b, P, n, 0, 0, s.r, rnd, true);
  // Droplets around it.
  const drops = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < drops; i++) {
    const a = rnd() * Math.PI * 2;
    const d = s.r * (1.25 + rnd() * 0.7);
    blob(b, P, n, Math.cos(a) * d, Math.sin(a) * d, s.r * (0.12 + rnd() * 0.14), rnd, false);
  }
  // Drips on walls: thin runs that end in a drop.
  if (!s.floor) {
    const drips = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < drips; i++) {
      const u = (rnd() - 0.5) * s.r;
      const len = s.r * (0.8 + rnd() * 1.4);
      const w = s.r * (0.1 + rnd() * 0.07);
      const top = -s.r * 0.4;
      const bottom = Math.max(-s.y + 0.6, top - len);
      b.face([P(u - w, top), P(u - w * 0.7, bottom), P(u + w * 0.7, bottom), P(u + w, top)], n);
      blob(b, P, n, u, bottom, w * 1.5, rnd, false);
    }
  }
}

// A blob around (cu, cv) as a fan of triangles (always convex enough to fill).
function blob(b, P, n, cu, cv, r, rnd, spiky) {
  const count = spiky ? POINTS : 6;
  const pts = [];
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2 + rnd() * 0.3;
    const spike = spiky && rnd() < 0.22 ? 1.35 + rnd() * 0.3 : 1;
    const rr = r * (0.78 + rnd() * 0.3) * spike;
    pts.push([cu + Math.cos(a) * rr, cv + Math.sin(a) * rr]);
  }
  const c = P(cu, cv);
  for (let k = 0; k < count; k++) {
    const p = pts[k];
    const q = pts[(k + 1) % count];
    b.face([c, P(p[0], p[1]), P(q[0], q[1])], n);
  }
}

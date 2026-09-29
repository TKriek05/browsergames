// Low-poly mesh builder: flat-shaded triangles with a colour per face.
// Vertex layout (11 floats): position xyz, normal xyz, colour rgb,
// emissive (0 = lit, 1 = glows / ignores light and fog), tint (0..1: how much
// the draw call's tint colour replaces this colour, e.g. a kart's paint).
export const FLOATS_PER_VERTEX = 11;

const colorCache = new Map();
export function rgb(hex) {
  let c = colorCache.get(hex);
  if (!c) {
    const n = parseInt(hex.slice(1), 16);
    c = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    colorCache.set(hex, c);
  }
  return c;
}

export class MeshBuilder {
  constructor() {
    this.v = [];
    this.c = [1, 1, 1];
    this.e = 0;
    this.t = 0;
  }

  // Current material for the next faces.
  color(hex, { emissive = 0, tint = 0 } = {}) {
    this.c = rgb(hex);
    this.e = emissive;
    this.t = tint;
    return this;
  }

  _vertex(p, n) {
    this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], this.c[0], this.c[1], this.c[2], this.e, this.t);
  }

  // A convex polygon (≥ 3 points). With a hint normal the winding is fixed
  // automatically so the face points that way (front faces are CCW).
  face(points, hint = null) {
    let [a, b, c] = points;
    let n = normal(a, b, c);
    if (hint && n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) {
      points = [...points].reverse();
      [a, b, c] = points;
      n = normal(a, b, c);
    }
    for (let i = 1; i < points.length - 1; i++) {
      this._vertex(points[0], n);
      this._vertex(points[i], n);
      this._vertex(points[i + 1], n);
    }
    return this;
  }

  // Axis-aligned box: centre x/z, bottom at y. Optional different top colour.
  box(x, y, z, sx, sy, sz, { top = null, bottom = true } = {}) {
    const x0 = x - sx / 2, x1 = x + sx / 2;
    const y0 = y, y1 = y + sy;
    const z0 = z - sz / 2, z1 = z + sz / 2;
    const side = this.c;
    this.face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
    this.face([[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], [0, 0, -1]);
    this.face([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0]);
    this.face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]);
    if (bottom) this.face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]);
    if (top) this.c = rgb(top);
    this.face([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [0, 1, 0]);
    this.c = side;
    return this;
  }

  // Box rotated around the y axis (same yaw convention as mat4.compose):
  // centre x/z, bottom at y, size sx (local x) × sy × sz (local z).
  orientedBox(x, y, z, sx, sy, sz, yaw) {
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const P = (lx, ly, lz) => [x + lx * c + lz * sn, y + ly, z - lx * sn + lz * c];
    const N = (lx, ly, lz) => [lx * c + lz * sn, ly, -lx * sn + lz * c];
    const hx = sx / 2, hz = sz / 2;
    this.face([P(-hx, 0, hz), P(hx, 0, hz), P(hx, sy, hz), P(-hx, sy, hz)], N(0, 0, 1));
    this.face([P(-hx, 0, -hz), P(-hx, sy, -hz), P(hx, sy, -hz), P(hx, 0, -hz)], N(0, 0, -1));
    this.face([P(hx, 0, -hz), P(hx, sy, -hz), P(hx, sy, hz), P(hx, 0, hz)], N(1, 0, 0));
    this.face([P(-hx, 0, -hz), P(-hx, 0, hz), P(-hx, sy, hz), P(-hx, sy, -hz)], N(-1, 0, 0));
    this.face([P(-hx, sy, -hz), P(-hx, sy, hz), P(hx, sy, hz), P(hx, sy, -hz)], N(0, 1, 0));
    this.face([P(-hx, 0, -hz), P(hx, 0, -hz), P(hx, 0, hz), P(-hx, 0, hz)], N(0, -1, 0));
    return this;
  }

  // Box with a slanted top: the +x end is `dropFront` lower (wedges, noses).
  wedge(x, y, z, sx, sy, sz, dropFront) {
    const x0 = x - sx / 2, x1 = x + sx / 2;
    const y0 = y, y1 = y + sy, yf = y + sy - dropFront;
    const z0 = z - sz / 2, z1 = z + sz / 2;
    this.face([[x0, y0, z1], [x1, y0, z1], [x1, yf, z1], [x0, y1, z1]], [0, 0, 1]);
    this.face([[x0, y0, z0], [x0, y1, z0], [x1, yf, z0], [x1, y0, z0]], [0, 0, -1]);
    this.face([[x1, y0, z0], [x1, yf, z0], [x1, yf, z1], [x1, y0, z1]], [1, 0, 0]);
    this.face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]);
    this.face([[x0, y1, z0], [x0, y1, z1], [x1, yf, z1], [x1, yf, z0]], [dropFront / sx, 1, 0]);
    return this;
  }

  // Vertical cylinder (low poly), bottom at y.
  cylinder(x, y, z, r, h, seg = 8, { top = null } = {}) {
    const side = this.c;
    const ring = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      ring.push([x + Math.cos(a) * r, z + Math.sin(a) * r]);
    }
    for (let i = 0; i < seg; i++) {
      const [ax, az] = ring[i];
      const [bx, bz] = ring[(i + 1) % seg];
      const mx = (ax + bx) / 2 - x;
      const mz = (az + bz) / 2 - z;
      this.face([[ax, y, az], [bx, y, bz], [bx, y + h, bz], [ax, y + h, az]], [mx, 0, mz]);
    }
    if (top) this.c = rgb(top);
    this.face(ring.map(([px, pz]) => [px, y + h, pz]), [0, 1, 0]);
    this.c = side;
    return this;
  }

  // Wheel: cylinder lying along the z axis, centred at (x, y, z).
  wheel(x, y, z, r, w, seg = 8, hub = null) {
    const side = this.c;
    const pts = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
    }
    const z0 = z - w / 2;
    const z1 = z + w / 2;
    for (let i = 0; i < seg; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % seg];
      this.face([[ax, ay, z0], [bx, by, z0], [bx, by, z1], [ax, ay, z1]], [(ax + bx) / 2 - x, (ay + by) / 2 - y, 0]);
    }
    if (hub) this.c = rgb(hub);
    this.face(pts.map(([px, py]) => [px, py, z1]), [0, 0, 1]);
    this.face(pts.map(([px, py]) => [px, py, z0]), [0, 0, -1]);
    this.c = side;
    return this;
  }

  // Octahedron (gems, bullets, item boxes' core).
  octa(x, y, z, r, ry = r) {
    const P = [[x + r, y, z], [x - r, y, z], [x, y + ry, z], [x, y - ry, z], [x, y, z + r], [x, y, z - r]];
    const F = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [0, 4, 3], [4, 1, 3], [1, 5, 3], [5, 0, 3]];
    for (const [a, b, c] of F) {
      const cx = (P[a][0] + P[b][0] + P[c][0]) / 3 - x;
      const cy = (P[a][1] + P[b][1] + P[c][1]) / 3 - y;
      const cz = (P[a][2] + P[b][2] + P[c][2]) / 3 - z;
      this.face([P[a], P[b], P[c]], [cx, cy, cz]);
    }
    return this;
  }

  // Cone / pyramid with `seg` sides standing on y (trees, spikes). No base.
  cone(x, y, z, r, h, seg = 6) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      this.face([[x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], [x, y + h, z]],
        [Math.cos(am), r / h, Math.sin(am)]);
    }
    return this;
  }

  // Low-poly sphere-ish blob (UV sphere with few segments).
  sphere(x, y, z, r, seg = 6, rings = 4) {
    for (let j = 0; j < rings; j++) {
      const t0 = (j / rings) * Math.PI;
      const t1 = ((j + 1) / rings) * Math.PI;
      for (let i = 0; i < seg; i++) {
        const p0 = (i / seg) * Math.PI * 2;
        const p1 = ((i + 1) / seg) * Math.PI * 2;
        const pt = (t, p) => [x + Math.sin(t) * Math.cos(p) * r, y + Math.cos(t) * r, z + Math.sin(t) * Math.sin(p) * r];
        const quad = [pt(t0, p0), pt(t1, p0), pt(t1, p1), pt(t0, p1)];
        const tm = (t0 + t1) / 2;
        const pm = (p0 + p1) / 2;
        const hint = [Math.sin(tm) * Math.cos(pm), Math.cos(tm), Math.sin(tm) * Math.sin(pm)];
        if (j === 0) this.face([quad[0], quad[1], quad[2]], hint);
        else if (j === rings - 1) this.face([quad[0], quad[1], quad[3]], hint);
        else this.face(quad, hint);
      }
    }
    return this;
  }

  // Flat strip between two edge polylines (roads, curbs). colorFn(i) may
  // return a hex colour per segment.
  ribbon(left, right, colorFn = null, closed = false) {
    const n = left.length;
    const segs = closed ? n : n - 1;
    const keep = this.c;
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n;
      if (colorFn) this.c = rgb(colorFn(i));
      this.face([left[i], right[i], right[j], left[j]], [0, 1, 0]);
    }
    this.c = keep;
    return this;
  }

  // Vertical double-sided wall along a polyline of [x, z] points (or
  // [x, z, base]: then the wall follows that base height, e.g. up a hill).
  wall(points, y, h, closed = false, colorFn = null) {
    const n = points.length;
    const segs = closed ? n : n - 1;
    const keep = this.c;
    for (let i = 0; i < segs; i++) {
      const [ax, az, ay = y] = points[i];
      const [bx, bz, by = y] = points[(i + 1) % n];
      if (colorFn) this.c = rgb(colorFn(i));
      const quad = [[ax, ay, az], [bx, by, bz], [bx, by + h, bz], [ax, ay + h, az]];
      const px = -(bz - az);
      const pz = bx - ax;
      this.face(quad, [px, 0, pz]);
      this.face(quad, [-px, 0, -pz]);
    }
    this.c = keep;
    return this;
  }

  get vertexCount() {
    return this.v.length / FLOATS_PER_VERTEX;
  }

  build() {
    return new Float32Array(this.v);
  }
}

function normal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

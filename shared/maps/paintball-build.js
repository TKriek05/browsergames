// Spetterveld level building blocks: boxes and cylinders with a bottom and a
// top (z0, z1), stairs made of steps, buildings with doors, windows, floors
// and a staircase inside, and point mirroring (every spawn sees the same
// field). Pure data; the physics only knows boxes and cylinders.

export const STOREY = 26; // floor to floor
export const SLAB = 1.5; // floor thickness
export const WALL = 2; // wall thickness
export const DOOR_H = 21; // doors are this high (the body is 17)
export const SILL = 8; // windows: from this high above the floor …
export const LINTEL = 18; // … to this high (you shoot through, you can not climb through)

export const box = (x, y, w, h, z0, z1, kind) => ({ t: 'box', x, y, w, h, z0, z1, kind });
export const can = (x, y, r, z0, z1, kind) => ({ t: 'can', x, y, r, z0, z1, kind });
// A box from corner to corner (x0 < x1, y0 < y1).
export const rect = (x0, y0, x1, y1, z0, z1, kind) => box((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, z0, z1, kind);

// Point mirror through the middle of a W × H field (solids and spots).
export function mirrorPoint(list, W, H) {
  return list.flatMap((o) => [o, { ...o, x: W - o.x, y: H - o.y }]);
}
// Left/right mirror.
export function mirrorX(list, W) {
  return list.flatMap((o) => [o, { ...o, x: W - o.x }]);
}

// Stairs: n steps of `depth` from (x0, y0) in direction dir ('+x', '-x',
// '+y', '-y'), `width` wide (centred on the other axis at `c`), rising from
// z to z + rise * n. Every step is a solid block down to the ground (or to z).
export function stairs({ at, c, dir, width = 12, n, rise, depth = 6, z = 0, kind = 'step', base = 0 }) {
  const out = [];
  const sgn = dir[0] === '+' ? 1 : -1;
  const alongX = dir[1] === 'x';
  for (let k = 0; k < n; k++) {
    const a0 = at + sgn * k * depth;
    const a1 = a0 + sgn * depth;
    const lo = Math.min(a0, a1);
    const hi = Math.max(a0, a1);
    const top = z + rise * (k + 1);
    if (alongX) out.push(rect(lo, c - width / 2, hi, c + width / 2, base, top, kind));
    else out.push(rect(c - width / 2, lo, c + width / 2, hi, base, top, kind));
  }
  return out;
}

// A wall from a to b along one axis at `line` (the other axis), z from z0 to
// z1, with openings [{ from, to, z0, z1 }] cut out of it.
function wallLine(alongX, line, a, b, z0, z1, openings, kind) {
  const out = [];
  const piece = (p, q, lo, hi) => {
    if (q - p < 0.5 || hi - lo < 0.5) return;
    if (alongX) out.push(rect(p, line - WALL / 2, q, line + WALL / 2, lo, hi, kind));
    else out.push(rect(line - WALL / 2, p, line + WALL / 2, q, lo, hi, kind));
  };
  const cuts = openings.filter((o) => o.to > a && o.from < b).sort((p, q) => p.from - q.from);
  let cur = a;
  for (const o of cuts) {
    const from = Math.max(a, o.from);
    const to = Math.min(b, o.to);
    piece(cur, from, z0, z1);
    piece(from, to, z0, Math.max(z0, o.z0)); // sill
    piece(from, to, Math.min(z1, o.z1), z1); // lintel
    cur = to;
  }
  piece(cur, b, z0, z1);
  return out;
}

// A floor slab over [x0, x1] × [y0, y1] at height z (its top), with holes.
function slab(x0, y0, x1, y1, z, holes, kind) {
  let parts = [[x0, y0, x1, y1]];
  for (const [hx0, hy0, hx1, hy1] of holes) {
    const next = [];
    for (const [a0, b0, a1, b1] of parts) {
      if (hx1 <= a0 || hx0 >= a1 || hy1 <= b0 || hy0 >= b1) {
        next.push([a0, b0, a1, b1]);
        continue;
      }
      if (hy0 > b0) next.push([a0, b0, a1, hy0]);
      if (hy1 < b1) next.push([a0, hy1, a1, b1]);
      const m0 = Math.max(b0, hy0);
      const m1 = Math.min(b1, hy1);
      if (hx0 > a0) next.push([a0, m0, hx0, m1]);
      if (hx1 < a1) next.push([hx1, m0, a1, m1]);
    }
    parts = next;
  }
  return parts.map(([a0, b0, a1, b1]) => rect(a0, b0, a1, b1, z - SLAB, z, kind));
}

// A building over [x0, x1] × [y0, y1] (outer wall lines) with `storeys`
// floors. openings: [{ side: 'n'|'s'|'w'|'e', storey, from, to, door? }]
// (door: from the floor up to DOOR_H; otherwise a window from SILL to LINTEL;
// or an explicit z0/z1, e.g. a gap in a roof parapet).
// stairs: [{ storey (from), at, c, dir, width }] each climbs one storey; the
// floor above gets a hole over it. roof: 'flat' (closed) | 'open' (the top
// floor is a roof terrace with a parapet `parapet` high) | 'none'.
export function building({ x0, y0, x1, y1, storeys = 2, openings = [], stairs: flights = [], roof = 'flat', parapet = 9, kinds = {} }) {
  const wallKind = kinds.wall ?? 'wall';
  const floorKind = kinds.floor ?? 'floor';
  const out = [];
  const top = storeys * STOREY;
  const cuts = (side) => openings.filter((o) => o.side === side).map((o) => {
    const base = (o.storey ?? 0) * STOREY;
    if (o.z0 !== undefined) return { from: o.from, to: o.to, z0: o.z0, z1: o.z1 };
    return o.door
      ? { from: o.from, to: o.to, z0: base, z1: base + DOOR_H }
      : { from: o.from, to: o.to, z0: base + SILL, z1: base + LINTEL };
  });
  const wallTop = roof === 'open' ? top + parapet : top;
  out.push(...wallLine(true, y0, x0 - WALL / 2, x1 + WALL / 2, 0, wallTop, cuts('n'), wallKind));
  out.push(...wallLine(true, y1, x0 - WALL / 2, x1 + WALL / 2, 0, wallTop, cuts('s'), wallKind));
  out.push(...wallLine(false, x0, y0 + WALL / 2, y1 - WALL / 2, 0, wallTop, cuts('w'), wallKind));
  out.push(...wallLine(false, x1, y0 + WALL / 2, y1 - WALL / 2, 0, wallTop, cuts('e'), wallKind));
  // Floors (and the roof) with a hole over every flight that arrives there.
  const ix0 = x0 + WALL / 2;
  const iy0 = y0 + WALL / 2;
  const ix1 = x1 - WALL / 2;
  const iy1 = y1 - WALL / 2;
  const levels = roof === 'none' ? storeys - 1 : storeys;
  for (let k = 1; k <= levels; k++) {
    const holes = flights.filter((s) => s.storey === k - 1).map((s) => stairHole(s));
    out.push(...slab(ix0, iy0, ix1, iy1, k * STOREY, holes, k === storeys ? kinds.roof ?? 'roof' : floorKind));
  }
  for (const s of flights) {
    const n = 8;
    out.push(...stairs({ ...s, n, rise: STOREY / n, depth: s.depth ?? 6, z: s.storey * STOREY, base: s.storey * STOREY - (s.storey ? SLAB : 0), kind: kinds.step ?? 'step' }));
  }
  return out;
}

// The hole a flight needs in the floor above.
function stairHole(s) {
  const n = 8;
  const depth = s.depth ?? 6;
  const width = s.width ?? 12;
  const sgn = s.dir[0] === '+' ? 1 : -1;
  // Only the first step stays under the floor: walking down from the third
  // step your head must not touch the edge of the floor above.
  const a0 = s.at + sgn * (depth - 2);
  const a1 = s.at + sgn * depth * n;
  const lo = Math.min(a0, a1);
  const hi = Math.max(a0, a1);
  return s.dir[1] === 'x'
    ? [lo, s.c - width / 2 - 1, hi, s.c + width / 2 + 1]
    : [s.c - width / 2 - 1, lo, s.c + width / 2 + 1, hi];
}

// Crenellations along a wall top: merlons every `every` from a to b.
export function merlons(alongX, line, a, b, z, { size = 3, len = 6, every = 12, h = 6, kind = 'merlon' } = {}) {
  const out = [];
  for (let p = a + (every - len) / 2; p + len <= b + 0.01; p += every) {
    if (alongX) out.push(rect(p, line - size / 2, p + len, line + size / 2, z, z + h, kind));
    else out.push(rect(line - size / 2, p, line + size / 2, p + len, z, z + h, kind));
  }
  return out;
}

// Turbo Kart GP circuits. A track is a closed Catmull-Rom spline through a
// few control points, sampled into a polyline (the "centre line"), with an
// optional height profile along the lap (hills: the physics uses the slope,
// the 3D view lifts the road). Sampling uses only + - * / and Math.sqrt,
// rounded to float32, so the server and every client build exactly the same
// track (the kart physics depends on it).
//
// Rules for a new track (checked by test/kartrace.test.js): no part of the
// road comes near another part (the physics looks for the closest bit of
// centre line), the start/finish straight is flat at height 0 (grid,
// gantry, grandstand) and slopes stay gentle.

const f = Math.fround;

// Control points in world units (≈ 1 kart = 12 units). y grows "south".
const DEFS = {
  ring: {
    name: 'Groene Vallei',
    width: 84,
    points: [[400, 0], [800, 0], [1100, 60], [1250, 250], [1200, 480], [1000, 560], [800, 500], [650, 560],
      [550, 750], [350, 850], [100, 820], [-100, 700], [-180, 450], [-150, 180], [0, 0]],
    items: [0.2, 0.47, 0.74], // item box rows (fraction of the lap)
    pads: [[0.09, 0], [0.58, -0.3], [0.86, 0.3]], // boost pads: fraction, lateral (-1..1 of half width)
    // Sunny summer day: green hills, pine trees, red/white barriers.
    theme: {
      sky: ['#3d8ee0', '#cfe8fb'], fog: '#d5e8f5', sun: ['#fffbe6', '#fff1b0'], sunDir: [0.5, 0.35, -1],
      light: { color: '#eee4cc', ambient: '#6f7a8c' }, clouds: 13,
      ground: ['#55a044', '#4e973e'], edge: '#c9b98a', road: ['#5b5c64', '#606169'], kerb: ['#e63946', '#f4f4f4'],
      wall: ['#f4f4f4', '#e63946'], trees: 'pine', leaves: ['#2f7a3b', '#3c8a45', '#28693a'],
      high: '#4a7f3a', shore: '#c9b98a', water: '#3a7fc0', mountain: ['#6f7a86', '#f4f7fa'], hilly: 110,
      buildings: 'farm', banners: ['#e63946', '#2a6fdb', '#ffb020', '#3c8a45'],
    },
  },
  park: {
    name: 'Herfstbos',
    width: 78,
    points: [[175, 0], [350, 0], [600, -80], [750, -250], [980, -300], [1150, -180], [1150, 50], [950, 180], [910, 360],
      [1040, 480], [1080, 610], [950, 730], [620, 720], [480, 600], [330, 570], [200, 620], [60, 720], [-150, 620], [-200, 380], [-100, 150], [0, 0]],
    items: [0.17, 0.44, 0.7],
    pads: [[0.06, 0], [0.33, 0.35], [0.62, -0.35], [0.9, 0]],
    // Autumn afternoon in the woods: low warm sun, orange trees, wooden fences.
    theme: {
      sky: ['#5a8fd0', '#f4dcb4'], fog: '#e8d8bc', sun: ['#fff0c8', '#ffcf80'], sunDir: [-0.6, 0.22, -1],
      light: { color: '#f0d8b4', ambient: '#76706a' }, clouds: 8,
      ground: ['#7d9a3e', '#76913a'], edge: '#a88a58', road: ['#57565a', '#5c5b5f'], kerb: ['#d9822b', '#f4efe4'],
      wall: ['#9a6a3c', '#86592f'], trees: 'round', leaves: ['#d9822b', '#c4452c', '#e8b23a', '#8a9a2e'],
      high: '#6f6a30', shore: '#a88a58', water: '#4a7a9a', mountain: ['#7a6a5c', '#f0f0ee'], hilly: 140,
      buildings: 'forest', banners: ['#d9822b', '#6b4a2e', '#f4efe4', '#3c6a3a'],
    },
  },
  boulevard: {
    name: 'Strandboulevard',
    width: 90,
    points: [[600, 0], [1200, 0], [1600, 100], [1800, 400], [1650, 700], [1300, 800], [900, 700], [600, 850],
      [250, 850], [-50, 700], [-200, 400], [-150, 120], [0, 0]],
    items: [0.14, 0.42, 0.69],
    pads: [[0.05, 0.35], [0.05, -0.35], [0.3, 0], [0.8, 0]],
    // Seaside at golden hour: sand, palm trees, blue/white barriers, the sea.
    theme: {
      sky: ['#4a78c0', '#ffc98a'], fog: '#f2d2a8', sun: ['#fff4d0', '#ffb060'], sunDir: [0.2, 0.12, 1],
      light: { color: '#f2d6b0', ambient: '#7a7080' }, clouds: 9,
      ground: ['#dcc890', '#93b05a'], edge: '#d4b878', road: ['#5a5a62', '#5f5f67'], kerb: ['#2a6fdb', '#f4f4f4'],
      wall: ['#f4f4f4', '#2a6fdb'], trees: 'palm', leaves: ['#3f8f3a', '#4fa046', '#35803a'],
      high: '#7f9a4a', shore: '#eed9a4', water: '#2f86c8', mountain: ['#9a8a6a', null], hilly: 70,
      buildings: 'beach', banners: ['#2a6fdb', '#f4f4f4', '#ffb020', '#e63946'], sea: true,
    },
  },
};

// --- Tracks with hills ------------------------------------------------------------------
// heights: [lap fraction, height] points; the road eases (smoothstep) from one to the next.
Object.assign(DEFS, {
  alpine: {
    name: 'Alpenpas',
    width: 80,
    points: [[300, 0], [700, 0], [1000, -80], [1150, -300], [1080, -540], [820, -610], [640, -540], [460, -610],
      [230, -650], [0, -540], [-150, -300], [-120, -80], [0, 0]],
    heights: [[0, 0], [0.06, 0], [0.2, 20], [0.33, 52], [0.45, 70], [0.55, 60], [0.66, 38], [0.8, 16], [0.93, 0], [1, 0]],
    items: [0.18, 0.46, 0.73],
    pads: [[0.08, 0], [0.5, 0.3], [0.86, -0.3]],
    // Crisp mountain morning: green alpine meadows, pines, grey rock, snowy peaks close by.
    theme: {
      sky: ['#2f7fd8', '#d8ecfa'], fog: '#dbe8f2', sun: ['#ffffff', '#fff4c8'], sunDir: [0.4, 0.45, -1],
      light: { color: '#f2f0e8', ambient: '#6a7890' }, clouds: 10,
      ground: ['#5fa84a', '#57a044'], edge: '#b9b2a2', road: ['#55565e', '#5a5b63'], kerb: ['#e63946', '#f4f4f4'],
      wall: ['#c8c8cc', '#8a8a92'], trees: 'pine', leaves: ['#2a6a36', '#347a3e', '#24603a'],
      high: '#8a8a88', shore: '#b9b2a2', water: '#3f86c6', mountain: ['#7a8490', '#f7f9fb'], hilly: 170,
      buildings: 'forest', banners: ['#e63946', '#f4f4f4', '#2a6fdb', '#3c8a45'],
    },
  },
  canyon: {
    name: 'Rode Canyon',
    width: 84,
    points: [[400, 0], [900, 0], [1300, 120], [1450, 380], [1300, 620], [1000, 650], [850, 480], [650, 450],
      [500, 650], [250, 700], [0, 560], [-120, 300], [0, 0]],
    heights: [[0, 0], [0.07, 0], [0.17, 26], [0.27, 6], [0.38, 38], [0.5, 12], [0.6, 34], [0.72, 8], [0.82, 22], [0.93, 0], [1, 0]],
    items: [0.15, 0.43, 0.7],
    pads: [[0.1, 0], [0.34, -0.3], [0.64, 0.3], [0.88, 0]],
    // Hot desert afternoon: red rock, sand, cacti, a pale dusty sky.
    theme: {
      sky: ['#4f8fd0', '#f6dcb4'], fog: '#efd6b4', sun: ['#fffae0', '#ffd890'], sunDir: [-0.5, 0.5, -1],
      light: { color: '#fbe8cc', ambient: '#7a6a62' }, clouds: 4,
      ground: ['#d9a86a', '#cf9c5e'], edge: '#b8744a', road: ['#5e5a58', '#63605d'], kerb: ['#f4f4f4', '#c4452c'],
      wall: ['#e8d8bc', '#b85a38'], trees: 'cactus', leaves: ['#4f8a3a', '#5a9a44', '#447a34'],
      high: '#b85a38', shore: '#d9b27a', water: '#3a8fb8', mountain: ['#b0583a', null], hilly: 150,
      buildings: 'desert', banners: ['#c4452c', '#ffb020', '#2a6fdb', '#f4f4f4'],
    },
  },
  volcano: {
    name: 'Vulkaaneiland',
    width: 86,
    points: [[500, 0], [1000, -40], [1350, 100], [1500, 400], [1400, 700], [1100, 850], [800, 760], [600, 900],
      [300, 900], [50, 760], [-100, 480], [-80, 200], [100, 40], [300, 0]],
    heights: [[0, 0], [0.07, 0], [0.25, 28], [0.4, 56], [0.5, 64], [0.62, 42], [0.78, 16], [0.9, 0], [1, 0]],
    items: [0.16, 0.45, 0.72],
    pads: [[0.06, 0.3], [0.06, -0.3], [0.55, 0], [0.84, 0]],
    // A tropical island: palm trees, black lava rock, a smoking volcano in the middle, the sea around.
    theme: {
      sky: ['#3a86d6', '#c8ecf4'], fog: '#d4ecee', sun: ['#fffbe0', '#ffe8a0'], sunDir: [0.3, 0.55, 1],
      light: { color: '#f4efdc', ambient: '#687a82' }, clouds: 12,
      ground: ['#4f9a3e', '#46903a'], edge: '#3a3434', road: ['#4e4d52', '#535257'], kerb: ['#ffb020', '#2a2a30'],
      wall: ['#f4f4f4', '#2a9d8f'], trees: 'palm', leaves: ['#2f8a3a', '#3fa046', '#2a7a34'],
      high: '#3a3434', shore: '#eed9a4', water: '#1f8fc8', mountain: ['#4a4040', null], hilly: 90,
      buildings: 'beach', banners: ['#2a9d8f', '#ffb020', '#e63946', '#f4f4f4'], sea: true, volcano: true,
    },
  },
});

export const KART_TRACK_IDS = Object.keys(DEFS);
// Grand Prix cups: three races in a row (setting value → tracks).
export const KART_CUPS = { gp: ['ring', 'park', 'boulevard'], gphills: ['alpine', 'canyon', 'volcano'] };
export const MAX_SLOPE = 0.2; // steepest allowed road (height per unit along the track)
export const WALL_MARGIN = 26; // barrier distance beyond the road edge (grass in between)
const SPACING = 12; // target distance between samples

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function build(id) {
  const def = DEFS[id];
  const P = def.points;
  const n = P.length;
  const xs = [];
  const ys = [];
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n];
    const p1 = P[i];
    const p2 = P[(i + 1) % n];
    const p3 = P[(i + 2) % n];
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const steps = Math.max(2, Math.ceil(Math.sqrt(dx * dx + dy * dy) / SPACING));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      xs.push(f(catmull(p0[0], p1[0], p2[0], p3[0], t)));
      ys.push(f(catmull(p0[1], p1[1], p2[1], p3[1], t)));
    }
  }
  const count = xs.length;
  const px = new Float32Array(xs);
  const py = new Float32Array(ys);
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
  const half = def.width / 2;

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

  const track = {
    id, name: def.name, width: def.width, half, count, px, py, tx, ty, seglen, cum, length, pz, slope,
    hilly: !!def.heights,
    theme: def.theme,
    boxes: [], pads: [], grid: [],
  };
  // Item boxes: rows of 4 across the road.
  for (const frac of def.items) {
    const at = pointAt(track, frac * length);
    for (let k = 0; k < 4; k++) {
      const lat = (k - 1.5) * (def.width / 4.6);
      track.boxes.push({ x: f(at.x - at.ty * lat), y: f(at.y + at.tx * lat) });
    }
  }
  for (const [frac, lat] of def.pads) {
    const at = pointAt(track, frac * length);
    track.pads.push({ x: f(at.x - at.ty * lat * half), y: f(at.y + at.tx * lat * half), dx: at.tx, dy: at.ty });
  }
  // Starting grid: two columns behind the finish line (distance 0).
  for (let slot = 0; slot < 6; slot++) {
    const back = 26 + Math.floor(slot / 2) * 26 + (slot % 2) * 10;
    const at = pointAt(track, length - back);
    const lat = (slot % 2 ? 1 : -1) * half * 0.42;
    track.grid.push({ x: f(at.x - at.ty * lat), y: f(at.y + at.tx * lat), hx: at.tx, hy: at.ty });
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
  return {
    x: track.px[i] + track.tx[i] * track.seglen[i] * t,
    y: track.py[i] + track.ty[i] * track.seglen[i] * t,
    tx: track.tx[i], ty: track.ty[i], seg: i,
  };
}

// Road height at a distance along the centre line.
export function heightAt(track, d) {
  const p = pointAt(track, d);
  const i = p.seg;
  const j = (i + 1) % track.count;
  const t = ((((d % track.length) + track.length) % track.length) - track.cum[i]) / track.seglen[i];
  return track.pz[i] + (track.pz[j] - track.pz[i]) * t;
}

// Closest point on the centre line. Writes into out:
//   seg, t (distance along that segment), dist (along the lap),
//   lateral: signed distance to the centre line (> 0: right of the driving direction),
//   nx, ny: the segment's right-hand normal, ox, oy: unit direction from the
//   closest point to (x, y) (points outwards: the way to push back is -o),
//   h: road height there, slope: the segment's slope (height per unit along the lap).
// Full scan: deterministic and cheap enough (a few hundred segments).
export function trackQuery(track, x, y, out) {
  const { px, py, tx, ty, seglen, count } = track;
  let best = Infinity;
  let bi = 0;
  let bt = 0;
  for (let i = 0; i < count; i++) {
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
  out.h = track.pz[bi] + (track.pz[j] - track.pz[bi]) * (bt / seglen[bi]);
  out.slope = track.slope[bi];
  return out;
}

export const createTrackQuery = () => ({ seg: 0, t: 0, dist: 0, lateral: 0, nx: 0, ny: 1, ox: 0, oy: 1, h: 0, slope: 0 });

export const KART_TRACKS = Object.fromEntries(KART_TRACK_IDS.map((id) => [id, build(id)]));

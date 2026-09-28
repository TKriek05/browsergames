// Turbo Kart GP circuits. A track is a closed Catmull-Rom spline through a
// few control points, sampled into a polyline (the "centre line"). Sampling
// uses only + - * / and Math.sqrt, rounded to float32, so the server and
// every client build exactly the same track (the kart physics depends on it).

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
    points: [[175, 0], [350, 0], [600, -80], [750, -250], [980, -300], [1150, -180], [1150, 50], [950, 180], [900, 380],
      [1050, 560], [900, 720], [600, 700], [450, 520], [250, 560], [80, 700], [-150, 620], [-200, 380], [-100, 150], [0, 0]],
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

export const KART_TRACK_IDS = Object.keys(DEFS);
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

  const track = {
    id, name: def.name, width: def.width, half, count, px, py, tx, ty, seglen, cum, length,
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

// Closest point on the centre line. Writes { seg, dist, lateral, nx, ny } into out.
// lateral > 0: right of the driving direction. Full scan: deterministic and
// cheap enough (a few hundred segments).
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
  out.dist = track.cum[bi] + bt;
  // Normal pointing to the right of the direction (y grows south).
  out.nx = -ty[bi];
  out.ny = tx[bi];
  out.lateral = (x - (px[bi] + tx[bi] * bt)) * out.nx + (y - (py[bi] + ty[bi] * bt)) * out.ny;
  return out;
}

export const KART_TRACKS = Object.fromEntries(KART_TRACK_IDS.map((id) => [id, build(id)]));

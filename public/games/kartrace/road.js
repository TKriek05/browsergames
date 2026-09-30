// Turbo Kart GP: the road itself, from the shared centre line: asphalt with
// the track's own width per stretch, edge lines, kerbs, gravel and barriers
// only where the track has them, open edges as a raised deck, bridges (deck
// + pillars wherever the road runs above the ground), jump ramps and the
// gaps you have to jump. groundAt(x, z) = terrain height (null: nothing
// below, the road floats).
export const ROAD_Y = 0.25;
const BARRIER_H = 4.5;
const DECK = 4; // thickness of a bridge deck
const PILLAR_EVERY = 5; // samples between bridge pillars
const LIFT = 5; // the road counts as a bridge this far above the ground
const SKIRT = 12; // the embankment face below a barrier reaches at least this deep
const CLEAR = 30; // pillars keep this far from any other bit of road (a road below a bridge)

// Runs of consecutive segments where pred(i) holds: [{ start, len, closed }].
function runs(n, pred) {
  const out = [];
  let first = -1;
  for (let i = 0; i < n; i++) if (!pred(i)) { first = i; break; }
  if (first < 0) return [{ start: 0, len: n, closed: true }];
  let i = (first + 1) % n;
  let cur = null;
  for (let k = 0; k < n; k++, i = (i + 1) % n) {
    if (pred(i)) {
      if (!cur) cur = { start: i, len: 0, closed: false };
      cur.len++;
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function buildRoad(b, t, th, groundAt) {
  const n = t.count;
  const P = (i, off, y) => [t.px[i] - t.ty[i] * off, y + t.pz[i], t.py[i] + t.tx[i] * off];
  const samples = (run) => Array.from({ length: run.closed ? run.len : run.len + 1 }, (_, k) => (run.start + k) % n);
  const band = (idx, a, c, y, closed, colorFn = null) => {
    b.ribbon(idx.map((i) => P(i, a(i), y)), idx.map((i) => P(i, c(i), y)), colorFn, closed);
  };
  const hw = (i) => t.hw[i];
  const wood = th.bridgeDeck === 'wood';

  // --- Road surface (not over the gaps) ---------------------------------------------------
  for (const run of runs(n, (i) => !t.gap[i])) {
    const idx = samples(run);
    const c = run.closed;
    b.color(th.road[0]);
    band(idx, (i) => -hw(i), hw, ROAD_Y, c, (k) => (wood && openAt(t, idx[k]) ? (k % 2 ? '#8a6a44' : '#7a5c3a') : (idx[k] >> 2) % 2 ? th.road[0] : th.road[1]));
    b.color('#f4f4f4');
    band(idx, (i) => -hw(i) + 3.5, (i) => -hw(i) + 2, ROAD_Y + 0.02, c);
    band(idx, (i) => hw(i) - 2, (i) => hw(i) - 3.5, ROAD_Y + 0.02, c);
    band(idx, (i) => -hw(i) - 7, (i) => -hw(i), ROAD_Y, c, (k) => ((idx[k] >> 1) % 2 ? th.kerb[0] : th.kerb[1]));
    band(idx, hw, (i) => hw(i) + 7, ROAD_Y, c, (k) => ((idx[k] >> 1) % 2 ? th.kerb[0] : th.kerb[1]));
    b.color('#e8e8e8');
    for (let k = 0; k + 2 < idx.length; k += 4) {
      const i = idx[k];
      const j = idx[k + 2];
      b.face([P(i, -0.9, ROAD_Y + 0.03), P(i, 0.9, ROAD_Y + 0.03), P(j, 0.9, ROAD_Y + 0.03), P(j, -0.9, ROAD_Y + 0.03)], [0, 1, 0]);
    }
  }
  // Gravel between the kerb and a barrier.
  for (const [side, wall] of [[-1, t.wl], [1, t.wr]]) {
    for (const run of runs(n, (i) => wall[i] >= 0 && !t.gap[i])) {
      const idx = samples(run);
      const inner = (i) => side * (hw(i) + 7);
      const outer = (i) => side * (hw(i) + Math.max(7, wall[i]));
      b.color(th.edge);
      band(idx, side < 0 ? outer : inner, side < 0 ? inner : outer, 0.12, run.closed);
    }
  }

  // --- Barriers (only where the track has them) ------------------------------------------------
  for (const [side, wall] of [[-1, t.wl], [1, t.wr]]) {
    for (const run of runs(n, (i) => wall[i] >= 0)) {
      const idx = samples(run);
      const off = (i) => side * (hw(i) + wall[i]);
      const line = idx.map((i) => {
        const [x, y, z] = P(i, off(i), 0);
        return [x, z, y];
      });
      b.wall(line, 0, BARRIER_H, run.closed, (k) => (Math.floor(idx[k] / 3) % 2 ? th.wall[0] : th.wall[1]));
      b.color(th.wall[1]);
      band(idx, (i) => off(i) - 1, (i) => off(i) + 1, BARRIER_H, run.closed);
    }
  }

  // --- Decks and bridges: wherever the road is above the ground ---------------------------------
  const lift = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (groundAt === null) lift[i] = 1;
    else {
      const [x, y, z] = P(i, 0, 0);
      lift[i] = y - groundAt(x, z) > LIFT ? 1 : 0;
    }
  }
  const lifted = (i) => lift[i] === 1;
  // Embankment faces below the barriers where the road runs on the ground
  // (the terrain beside it lies a little lower).
  if (groundAt !== null) {
    for (const [side, wall] of [[-1, t.wl], [1, t.wr]]) {
      b.color(th.edge);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (wall[i] < 0 || wall[j] < 0 || lifted(i) || lifted(j) || t.gap[i]) continue;
        const top = (k) => P(k, side * (hw(k) + wall[k] + 1), 0);
        const foot = (k) => {
          const [x, y, z] = P(k, side * (hw(k) + wall[k] + 5), 0);
          return [x, Math.min(y - SKIRT, groundAt(x, z) - 2), z];
        };
        b.face([top(i), top(j), foot(j), foot(i)], [-t.ty[i] * side, 0.4, t.tx[i] * side]);
      }
    }
  }
  // Is (x, z) on another stretch of road than around sample i? (no pillars there)
  const onOtherRoad = (x, z, i) => {
    for (let k = 0; k < n; k += 2) {
      const di = Math.abs(k - i);
      if (Math.min(di, n - di) < 40) continue;
      const r = hw(k) + CLEAR;
      if ((t.px[k] - x) ** 2 + (t.py[k] - z) ** 2 < r * r) return true;
    }
    return false;
  };
  for (const run of runs(n, (i) => lifted(i) && !t.gap[i])) {
    const idx = samples(run);
    const outer = (i, side) => side * (hw(i) + Math.max(7, side < 0 ? t.wl[i] : t.wr[i]) + 1);
    // Underside and the two side faces.
    b.color(wood ? '#6a4a2e' : th.bridge ?? '#8a8a92');
    const segs = run.closed ? idx.length : idx.length - 1;
    for (let k = 0; k < segs; k++) {
      const i = idx[k];
      const j = idx[(k + 1) % idx.length];
      b.face([P(i, outer(i, -1), -DECK), P(i, outer(i, 1), -DECK), P(j, outer(j, 1), -DECK), P(j, outer(j, -1), -DECK)], [0, -1, 0]);
      for (const side of [-1, 1]) {
        b.face([P(i, outer(i, side), ROAD_Y), P(j, outer(j, side), ROAD_Y), P(j, outer(j, side), -DECK), P(i, outer(i, side), -DECK)],
          [-t.ty[i] * side, 0, t.tx[i] * side]);
      }
    }
    // Pillars down to the ground (not when floating in the sky).
    if (groundAt === null) continue;
    for (let k = 0; k < idx.length; k += PILLAR_EVERY) {
      const i = idx[k];
      for (const side of [-0.6, 0.6]) {
        const [x, y, z] = P(i, side * hw(i), -DECK);
        const g = groundAt(x, z);
        if (y - g < 3 || onOtherRoad(x, z, i)) continue;
        b.color(wood ? '#5a3e26' : '#9a9aa2').box(x, g - 2, z, wood ? 3 : 5, y - g + 2, wood ? 3 : 5);
      }
    }
  }

  // --- Jump ramps: a striped wedge across the road ------------------------------------------------
  for (const r of t.ramps) {
    const i = r.seg;
    const len = 26;
    const lift = 6;
    const back = (lat) => P(i, lat, ROAD_Y + 0.05).map((v, k) => v - (k === 0 ? t.tx[i] * len : k === 2 ? t.ty[i] * len : 0));
    const lip = (lat, y) => P(i, lat, ROAD_Y + y);
    const L = -hw(i);
    const R = hw(i);
    const stripes = 8;
    for (let s = 0; s < stripes; s++) {
      const a = L + ((R - L) * s) / stripes;
      const c = L + ((R - L) * (s + 1)) / stripes;
      b.color(s % 2 ? '#ffb020' : '#2a2a30', { emissive: s % 2 ? 0.2 : 0 });
      b.face([back(a), back(c), lip(c, lift), lip(a, lift)], [-t.tx[i], 1.5, -t.ty[i]]);
    }
    b.color('#3a3a42').face([lip(L, lift), lip(R, lift), lip(R, 0), lip(L, 0)], [t.tx[i], 0, t.ty[i]]);
  }
  return b;
}

// No barrier on either side here (a deck, a rope bridge).
export function openAt(t, i) {
  return t.wl[i] < 0 && t.wr[i] < 0;
}

export { runs };

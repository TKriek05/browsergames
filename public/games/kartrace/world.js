// Turbo Kart GP scenery: everything static for one track in a single mesh,
// styled by the track's theme (see shared/maps/kart-tracks.js): ground and
// field patches, distant hills (and the sea), asphalt with kerbs and lines,
// painted barriers, trees, a grandstand, the start gantry and boost pads.
// Scenery positions come from a seeded generator: same track, same world.
import { MeshBuilder } from '../../js/gl/mesh.js';
import { yawFromDir } from '../../js/gl/mat4.js';
import { WALL_MARGIN, pointAt } from '../../../shared/maps/kart-tracks.js';

export const ROAD_Y = 0.25;
const BARRIER_H = 4.5;
const TREE_STEP = 70; // grid spacing of tree candidates
const TREE_BAND = 620; // trees up to this far from the centre line
const TREE_CHANCE = 0.55;

function seeded(seed) {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

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
  const size = Math.max(maxX - minX, maxY - minY) + 3200;
  const lim = t.half + WALL_MARGIN;
  const seaY = th.sea ? maxY + 330 : Infinity; // the sea starts south of the track

  // Distance from a point to the centre line (every 2nd sample is plenty here).
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

  // Ground with a few patches in the second tone, then the sea.
  b.color(th.ground[0]).box(cx, -1, cy, size, 1, size);
  b.color(th.ground[1]);
  for (let i = 0; i < 70; i++) {
    const x = cx + (rnd() - 0.5) * size * 0.7;
    const y = cy + (rnd() - 0.5) * size * 0.7;
    const w = 120 + rnd() * 320;
    const h = 120 + rnd() * 320;
    if (y + h / 2 > seaY) continue;
    b.face([[x - w / 2, 0.02, y - h / 2], [x - w / 2, 0.02, y + h / 2], [x + w / 2, 0.02, y + h / 2], [x + w / 2, 0.02, y - h / 2]], [0, 1, 0]);
  }
  if (th.sea) {
    const far = cy + size / 2;
    b.color(th.sea).face([[cx - size / 2, 0.1, seaY], [cx - size / 2, 0.1, far], [cx + size / 2, 0.1, far], [cx + size / 2, 0.1, seaY]], [0, 1, 0]);
    b.color('#f4f4f4');
    for (let x = cx - size / 2; x < cx + size / 2; x += 60) {
      const y = seaY + 8 + rnd() * 20;
      b.face([[x, 0.15, y], [x, 0.15, y + 2], [x + 26, 0.15, y + 2], [x + 26, 0.15, y]], [0, 1, 0]);
    }
  }

  // Rolling hills on the horizon (two rings; none over the sea).
  for (const [ring, hMin, hVar, color] of [[size / 2 - 250, 90, 160, th.hills[1]], [size / 2 - 520, 50, 90, th.hills[0]]]) {
    const n = 40;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const px = (a) => cx + Math.cos(a) * ring;
      const pz = (a) => cy + Math.sin(a) * ring;
      if (pz(am) > seaY - 100) continue;
      const h = hMin + rnd() * hVar;
      const inward = [-Math.cos(am), 0, -Math.sin(am)];
      const spread = 0.09;
      // A rounded hill: a fan of triangles over a low arc.
      const steps = 4;
      for (let k = 0; k < steps; k++) {
        const u0 = k / steps;
        const u1 = (k + 1) / steps;
        const ang = (u) => a0 - spread + (a1 - a0 + spread * 2) * u;
        const hu = (u) => h * Math.sin(Math.PI * u);
        b.color(color).face([[px(ang(u0)), 0, pz(ang(u0))], [px(ang(u1)), 0, pz(ang(u1))], [px(ang(u1)), hu(u1), pz(ang(u1))], [px(ang(u0)), hu(u0), pz(ang(u0))]], inward);
      }
    }
  }

  // Road: asphalt, white edge lines, kerbs, centre dashes.
  const edge = (off, y) => {
    const pts = [];
    for (let i = 0; i < t.count; i++) pts.push([t.px[i] - t.ty[i] * off, y, t.py[i] + t.tx[i] * off]);
    return pts;
  };
  const L = edge(-t.half, ROAD_Y);
  const R = edge(t.half, ROAD_Y);
  b.color(th.road[0]).ribbon(L, R, (i) => ((i >> 2) % 2 ? th.road[0] : th.road[1]), true);
  b.color('#f4f4f4');
  b.ribbon(edge(-t.half + 3.5, ROAD_Y + 0.02), edge(-t.half + 2, ROAD_Y + 0.02), null, true);
  b.ribbon(edge(t.half - 2, ROAD_Y + 0.02), edge(t.half - 3.5, ROAD_Y + 0.02), null, true);
  b.ribbon(edge(-t.half - 7, ROAD_Y), L, (i) => ((i >> 1) % 2 ? th.kerb[0] : th.kerb[1]), true);
  b.ribbon(R, edge(t.half + 7, ROAD_Y), (i) => ((i >> 1) % 2 ? th.kerb[0] : th.kerb[1]), true);
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

  // Trees (or palms) around the circuit, never on the track or in the sea.
  const x0 = minX - TREE_BAND;
  const y0 = minY - TREE_BAND;
  for (let gy = y0; gy <= maxY + TREE_BAND; gy += TREE_STEP) {
    for (let gx = x0; gx <= maxX + TREE_BAND; gx += TREE_STEP) {
      const x = gx + (rnd() - 0.5) * TREE_STEP * 0.8;
      const y = gy + (rnd() - 0.5) * TREE_STEP * 0.8;
      const pick = rnd();
      const scale = 0.8 + rnd() * 0.6;
      if (pick > TREE_CHANCE || y > seaY - 60) continue;
      const d = distToTrack(x, y);
      if (d < lim + 24 || d > TREE_BAND) continue;
      tree(b, th, x, y, scale, rnd);
    }
  }

  grandstand(b, t, th, lim, rnd);
  startGantry(b, t, th);

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
      b.color(k === 1 ? '#ff7a1a' : '#ffb020', { emissive: 0.5 }).face([tip, l, mid], [0, 1, 0]).face([tip, mid, rr], [0, 1, 0]);
    }
  }
  return b.build();
}

function tree(b, th, x, y, s, rnd) {
  const leaf = th.leaves[Math.floor(rnd() * th.leaves.length)];
  if (th.trees === 'pine') {
    b.color('#6b4a2e').box(x, 0, y, 2.4 * s, 6 * s, 2.4 * s, { bottom: false });
    b.color(leaf);
    b.cone(x, 5 * s, y, 10 * s, 15 * s, 6).cone(x, 13 * s, y, 7 * s, 12 * s, 6);
  } else if (th.trees === 'round') {
    b.color('#5e412a').box(x, 0, y, 2.6 * s, 9 * s, 2.6 * s, { bottom: false });
    b.color(leaf).sphere(x, 15 * s, y, 8.5 * s, 6, 4);
  } else {
    // Palm: a slightly bent trunk and drooping leaves.
    b.color('#8a6a44');
    for (let k = 0; k < 4; k++) b.box(x + k * 0.9 * s, k * 6 * s, y, 2.4 * s, 6.2 * s, 2.4 * s, { bottom: false });
    const tx = x + 3.6 * s;
    const ty = 24 * s;
    b.color(leaf);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + rnd() * 0.4;
      const ex = tx + Math.cos(a) * 13 * s;
      const ez = y + Math.sin(a) * 13 * s;
      const px = -Math.sin(a) * 2.2 * s;
      const pz = Math.cos(a) * 2.2 * s;
      const blade = [[tx + px, ty + 1, y + pz], [tx - px, ty + 1, y - pz], [ex, ty - 6 * s, ez]];
      b.face(blade, [0, 1, 0]).face(blade, [0, -1, 0]);
    }
  }
}

// Grandstand with a crowd along the start straight (outside the barrier).
function grandstand(b, t, th, lim, rnd) {
  const f0 = pointAt(t, t.length * 0.02);
  const yaw = yawFromDir(f0.tx, f0.ty);
  const at = (lat, along = 0) => [f0.x - f0.ty * lat + f0.tx * along, f0.y + f0.tx * lat + f0.ty * along];
  const len = 170;
  const crowd = ['#e63946', '#f4f4f4', '#2a6fdb', '#ffb020', '#3c8a45', '#8a4fb8', '#1c1c28'];
  for (let k = 0; k < 5; k++) {
    const lat = -(lim + 14 + k * 8);
    const [x, z] = at(lat);
    const h = 4 + k * 4;
    b.color(k % 2 ? '#b8b8c0' : '#c4c4cc').orientedBox(x, 0, z, len, h, 8, yaw);
    for (let i = 0; i < 28; i++) {
      if (rnd() < 0.2) continue;
      const [px, pz] = at(lat + 1.5, -len / 2 + 4 + i * ((len - 8) / 27));
      b.color(crowd[Math.floor(rnd() * crowd.length)]).orientedBox(px, h, pz, 2.6, 3.4 + rnd(), 2.6, yaw);
    }
  }
  // Roof on posts
  for (const along of [-len / 2 + 3, 0, len / 2 - 3]) {
    const [x, z] = at(-(lim + 50), along);
    b.color('#8a8a92').orientedBox(x, 0, z, 2, 36, 2, yaw);
  }
  const [rx, rz] = at(-(lim + 32));
  b.color(th.wall[1]).orientedBox(rx, 36, rz, len + 6, 1.5, 44, yaw);
}

// Start/finish: checkered line and a gantry with start lights.
function startGantry(b, t, th) {
  const f0 = pointAt(t, 0);
  const cells = 10;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < cells; col++) {
      const a = -t.half + (col / cells) * t.half * 2;
      const bb = a + (t.half * 2) / cells;
      const d0 = row * 5;
      const d1 = d0 + 5;
      const P = (lat, d) => [f0.x + f0.tx * d - f0.ty * lat, ROAD_Y + 0.06, f0.y + f0.ty * d + f0.tx * lat];
      b.color((row + col) % 2 ? '#f4f4f4' : '#15151c').face([P(a, d0), P(bb, d0), P(bb, d1), P(a, d1)], [0, 1, 0]);
    }
  }
  const post = (lat) => [f0.x - f0.ty * lat, f0.y + f0.tx * lat];
  for (const lat of [-(t.half + 12), t.half + 12]) {
    const [x, z] = post(lat);
    b.color('#9a9aa4').box(x, 0, z, 3.5, 30, 3.5);
  }
  const [gx, gz] = post(0);
  const yaw = yawFromDir(f0.tx, f0.ty);
  const span = (t.half + 12) * 2;
  b.color('#9a9aa4').orientedBox(gx, 30, gz, 3, 5, span, yaw);
  // Banner in the circuit's colours + five start lights
  b.color(th.wall[1]).orientedBox(gx - f0.tx * 1.8, 25, gz - f0.ty * 1.8, 0.5, 5, span * 0.7, yaw);
  for (let k = 0; k < 5; k++) {
    const lat = (k - 2) * 7;
    const [lx, lz] = post(lat);
    b.color('#1c1c24').orientedBox(lx, 35, lz, 3, 5, 5, yaw);
    b.color('#ff3b30', { emissive: 0.8 }).orientedBox(lx - f0.tx * 1.6, 36, lz - f0.ty * 1.6, 0.4, 3, 3, yaw);
  }
}

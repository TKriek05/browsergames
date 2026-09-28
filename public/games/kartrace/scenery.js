// Turbo Kart GP scenery on top of the terrain (see world.js): trees with a
// blob shadow, buildings that fit the circuit (a farm with a windmill, log
// cabins in the woods, a lighthouse and beach huts at the coast), a
// grandstand, the start gantry, tyre stacks in the corners and billboards
// along the straights. All positions come from the seeded generator.
import { yawFromDir } from '../../js/gl/mat4.js';
import { pointAt } from '../../../shared/maps/kart-tracks.js';

const TREE_STEP = 64; // grid spacing of tree candidates
const TREE_BAND = 680; // trees up to this far from the centre line
const TREE_CHANCE = 0.42;

export function addScenery(b, w) {
  const used = []; // { x, y, r } footprints of buildings (trees keep away)
  buildings(b, w, used);
  trees(b, w, used);
  tyreStacks(b, w);
  billboards(b, w);
  grandstand(b, w);
  startGantry(b, w);
}

// --- Helpers --------------------------------------------------------------------------------
// Local frame at (x, y, z) turned by yaw: P(lx, ly, lz) → world point.
function frame(x, y, z, yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
}

// Direction of a local vector in world space (for face orientation hints).
function dir(P, lx, ly, lz) {
  const o = P(0, 0, 0);
  const q = P(lx, ly, lz);
  return [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
}

// Gabled roof in a local frame: ridge along local x, eaves at height y0.
function gable(b, P, w, d, y0, h, roof, wall) {
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  const e = 1.5; // overhang
  b.color(roof);
  b.face([P(x0 - e, y0 - 0.5, z1 + e), P(x1 + e, y0 - 0.5, z1 + e), P(x1 + e, y0 + h, 0), P(x0 - e, y0 + h, 0)], dir(P, 0, 1, 1));
  b.face([P(x0 - e, y0 - 0.5, z0 - e), P(x1 + e, y0 - 0.5, z0 - e), P(x1 + e, y0 + h, 0), P(x0 - e, y0 + h, 0)], dir(P, 0, 1, -1));
  b.color(wall);
  b.face([P(x1, y0, z0), P(x1, y0 + h - 0.3, 0), P(x1, y0, z1)], dir(P, 1, 0, 0));
  b.face([P(x0, y0, z0), P(x0, y0 + h - 0.3, 0), P(x0, y0, z1)], dir(P, -1, 0, 0));
}

// A spot for a building: distance to the track within [minD, maxD], dry, free.
function findSpot(w, used, minD, maxD, radius, tries = 60) {
  for (let k = 0; k < tries; k++) {
    const { minX, maxX, minY, maxY } = w.bounds;
    const x = minX - maxD + w.rnd() * (maxX - minX + maxD * 2);
    const y = minY - maxD + w.rnd() * (maxY - minY + maxD * 2);
    const d = w.distToTrack(x, y);
    if (d < minD || d > maxD) continue;
    if (w.lake && Math.hypot(x - w.lake.x, y - w.lake.y) < w.lake.r + radius + 20) continue;
    if (y > w.seaY - 70 - radius) continue;
    if (used.some((u) => Math.hypot(u.x - x, u.y - y) < u.r + radius + 10)) continue;
    used.push({ x, y, r: radius });
    return { x, y, h: w.heightAt(x, y), yaw: faceTrack(w.t, x, y) };
  }
  return null;
}

// Yaw so that local +x points at the nearest bit of track.
function faceTrack(t, x, y) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < t.count; i += 3) {
    const d = (t.px[i] - x) ** 2 + (t.py[i] - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return yawFromDir(t.px[best] - x, t.py[best] - y);
}

// --- Buildings per theme ------------------------------------------------------------------
function buildings(b, w, used) {
  const kind = w.th.buildings;
  if (kind === 'farm') {
    const farm = findSpot(w, used, w.lim + 110, 420, 70);
    if (farm) {
      const P = frame(farm.x, farm.h, farm.y, farm.yaw);
      // Red barn with a grey roof and white doors
      const [bx, , bz] = P(-10, 0, -18);
      b.color('#a8382a').orientedBox(bx, farm.h, bz, 40, 18, 26, farm.yaw);
      gable(b, frame(bx, farm.h, bz, farm.yaw), 40, 26, 18, 11, '#5a5a62', '#a8382a');
      const [dx, , dz] = P(10.3, 0, -18);
      b.color('#f4f0e8').orientedBox(dx, farm.h, dz, 0.6, 12, 10, farm.yaw);
      // Silo
      const [sx, , sz] = P(-10, 0, 10);
      b.color('#c8c8cc').cylinder(sx, farm.h, sz, 7, 34, 10, { top: '#9a9aa2' });
      b.color('#8a8a92').cone(sx, farm.h + 34, sz, 7.5, 6, 10);
      // Farmhouse
      const [hx, , hz] = P(24, 0, 22);
      b.color('#f0ebe0').orientedBox(hx, farm.h, hz, 22, 12, 16, farm.yaw + Math.PI / 2);
      gable(b, frame(hx, farm.h, hz, farm.yaw + Math.PI / 2), 22, 16, 12, 8, '#9a3a2a', '#f0ebe0');
      // Hay bales and a fence
      for (let k = 0; k < 5; k++) {
        const [px, , pz] = P(-40 - k * 9, 0, 26 + (k % 2) * 7);
        b.color('#d8b860').cylinder(px, farm.h, pz, 3.2, 4.2, 8, { top: '#c8a850' });
      }
      fence(b, P, -60, -40, 60, 40, farm.h);
    }
    const mill = findSpot(w, used, w.lim + 140, 600, 30);
    if (mill) windmill(b, mill);
    for (let k = 0; k < 3; k++) {
      const h = findSpot(w, used, w.lim + 100, 650, 22);
      if (h) house(b, h, ['#f0ebe0', '#d8c8a8', '#c9784e'][k], ['#9a3a2a', '#4a4a52', '#6a2a22'][k]);
    }
  } else if (kind === 'forest') {
    for (let k = 0; k < 5; k++) {
      const c = findSpot(w, used, w.lim + 90, 620, 22);
      if (c) cabin(b, c);
    }
    const tw = findSpot(w, used, w.lim + 120, 500, 14);
    if (tw) watchtower(b, tw);
  } else if (kind === 'beach') {
    // Lighthouse and huts along the shore, a hotel further inland.
    const shore = { minD: w.lim + 60 };
    const lx = (w.bounds.minX + w.bounds.maxX) / 2 + 500;
    const ly = w.seaY - 40;
    used.push({ x: lx, y: ly, r: 20 });
    lighthouse(b, lx, w.heightAt(lx, ly), ly);
    const colors = ['#2a6fdb', '#ffb020', '#e63946', '#3cb4a0', '#f4f4f4', '#8a4fb8'];
    for (let k = 0; k < 9; k++) {
      const x = w.bounds.minX - 150 + k * 90;
      const y = w.seaY - 90;
      if (w.distToTrack(x, y) < shore.minD) continue;
      used.push({ x, y, r: 10 });
      beachHut(b, x, w.heightAt(x, y), y, colors[k % colors.length]);
    }
    for (let k = 0; k < 2; k++) {
      const hotel = findSpot(w, used, w.lim + 140, 600, 40);
      if (hotel) hotelBlock(b, hotel, k);
    }
    for (let k = 0; k < 14; k++) {
      const x = w.bounds.minX - 100 + w.rnd() * (w.bounds.maxX - w.bounds.minX + 200);
      const y = w.seaY - 30 + w.rnd() * 25;
      if (w.distToTrack(x, y) < shore.minD) continue;
      umbrella(b, x, w.heightAt(x, y), y, colors[k % colors.length]);
    }
  }
}

function fence(b, P, x0, z0, x1, z1, y) {
  const post = (lx, lz) => {
    const [x, , z] = P(lx, 0, lz);
    b.color('#8a6a44').box(x, y, z, 1, 4, 1, { bottom: false });
  };
  for (let lx = x0; lx <= x1; lx += 10) { post(lx, z0); post(lx, z1); }
  for (let lz = z0; lz <= z1; lz += 10) { post(x0, lz); post(x1, lz); }
}

function house(b, s, wall, roof) {
  b.color(wall).orientedBox(s.x, s.h, s.y, 18, 11, 14, s.yaw);
  gable(b, frame(s.x, s.h, s.y, s.yaw), 18, 14, 11, 7, roof, wall);
  const P = frame(s.x, s.h, s.y, s.yaw);
  const [wx, , wz] = P(9.1, 0, -3);
  b.color('#7fb0d8').orientedBox(wx, s.h + 5, wz, 0.4, 3, 3, s.yaw);
  const [dx, , dz] = P(9.1, 0, 3);
  b.color('#5a3a22').orientedBox(dx, s.h, dz, 0.4, 7, 3.5, s.yaw);
}

function windmill(b, s) {
  // A Dutch windmill: dark wooden body, thatched cap, four sails facing the track.
  b.color('#5e4a3a').cylinder(s.x, s.h, s.y, 9, 32, 8, { top: '#4a3a2e' });
  b.color('#6a6a3a').cone(s.x, s.h + 32, s.y, 10, 10, 8);
  const P = frame(s.x, s.h + 34, s.y, s.yaw);
  b.color('#e8e0d0');
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const q = (along, across) => {
      const ly = ca * along - sa * across;
      const lz = sa * along + ca * across;
      return P(10.5, ly, lz);
    };
    const blade = [q(3, -1.2), q(28, -2.6), q(28, 2.6), q(3, 1.2)];
    b.face(blade, dir(P, 1, 0, 0)).face(blade, dir(P, -1, 0, 0));
  }
}

function cabin(b, s) {
  const P = frame(s.x, s.h, s.y, s.yaw);
  b.color('#7a4f2e').orientedBox(s.x, s.h, s.y, 20, 10, 14, s.yaw);
  b.color('#5e3a20');
  for (let k = 1; k < 4; k++) b.orientedBox(s.x, s.h + k * 2.5, s.y, 20.4, 0.5, 14.4, s.yaw);
  gable(b, P, 20, 14, 10, 7, '#3a3a36', '#7a4f2e');
  const [cx, , cz] = P(-6, 0, 3);
  b.color('#6a6a6a').box(cx, s.h + 12, cz, 2.5, 7, 2.5);
  const [wx, , wz] = P(10.1, 0, 0);
  b.color('#ffd27a', { emissive: 0.3 }).orientedBox(wx, s.h + 4, wz, 0.4, 3, 3, s.yaw);
}

function watchtower(b, s) {
  b.color('#6b4a2e');
  for (const [dx, dz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) b.box(s.x + dx, s.h, s.y + dz, 1.6, 30, 1.6);
  b.color('#8a6a44').box(s.x, s.h + 30, s.y, 14, 1.5, 14);
  b.color('#8a6a44').box(s.x, s.h + 31.5, s.y, 14, 3, 0.8).box(s.x, s.h + 31.5, s.y + 6.6, 14, 3, 0.8);
  b.color('#4a3a2a').cone(s.x, s.h + 38, s.y, 11, 7, 4);
  for (const [dx, dz] of [[-6, -6], [6, 6]]) b.color('#6b4a2e').box(s.x + dx, s.h + 31, s.y + dz, 1, 7, 1);
}

function lighthouse(b, x, h, z) {
  for (let k = 0; k < 6; k++) b.color(k % 2 ? '#f4f4f4' : '#d62828').cylinder(x, h + k * 8, z, 7 - k * 0.5, 8, 10);
  b.color('#2a2a30').cylinder(x, h + 48, z, 5, 1.5, 10);
  b.color('#ffe8a0', { emissive: 0.7 }).cylinder(x, h + 49.5, z, 3.5, 4, 8);
  b.color('#d62828').cone(x, h + 53.5, z, 5, 5, 10);
}

function beachHut(b, x, h, z, color) {
  b.color(color).box(x, h, z, 10, 8, 9, { top: '#f4f4f4' });
  b.color('#f4f4f4').box(x, h, z + 4.6, 3.5, 6, 0.3);
  gable(b, frame(x, h, z, 0), 10, 9, 8, 4, '#f4f4f4', color);
}

function hotelBlock(b, s, k) {
  const floors = 4 + k * 2;
  const wall = k ? '#f0ebe0' : '#e8d8c0';
  b.color(wall).orientedBox(s.x, s.h, s.y, 50, floors * 7, 20, s.yaw);
  const P = frame(s.x, s.h, s.y, s.yaw);
  for (let f = 0; f < floors; f++) {
    for (let i = 0; i < 6; i++) {
      const [wx, , wz] = P(-20 + i * 8, 0, 10.1);
      b.color('#5a8ab8').orientedBox(wx, s.h + 2 + f * 7, wz, 4, 3.5, 0.4, s.yaw);
    }
  }
  b.color('#c8b8a0').orientedBox(s.x, s.h + floors * 7, s.y, 52, 1.2, 22, s.yaw);
}

function umbrella(b, x, h, z, color) {
  b.color('#f4f4f4').box(x, h, z, 0.6, 7, 0.6);
  b.color(color).cone(x, h + 6, z, 7, 2.5, 8);
  b.color(color).box(x + 4, h + 0.1, z + 3, 4, 0.2, 8);
}

// --- Trees -----------------------------------------------------------------------------------
function trees(b, w, used) {
  const { minX, maxX, minY, maxY } = w.bounds;
  for (let gy = minY - TREE_BAND; gy <= maxY + TREE_BAND; gy += TREE_STEP) {
    for (let gx = minX - TREE_BAND; gx <= maxX + TREE_BAND; gx += TREE_STEP) {
      const x = gx + (w.rnd() - 0.5) * TREE_STEP * 0.8;
      const y = gy + (w.rnd() - 0.5) * TREE_STEP * 0.8;
      const pick = w.rnd();
      const scale = 0.8 + w.rnd() * 0.7;
      if (pick > TREE_CHANCE || y > w.seaY - 60) continue;
      if (w.lake && Math.hypot(x - w.lake.x, y - w.lake.y) < w.lake.r + 15) continue;
      if (used.some((u) => Math.hypot(u.x - x, u.y - y) < u.r)) continue;
      const d = w.distToTrack(x, y);
      if (d < w.lim + 24 || d > TREE_BAND) continue;
      tree(b, w.th, x, w.heightAt(x, y), y, scale, w.rnd);
    }
  }
}

function tree(b, th, x, h, y, s, rnd) {
  const leaf = th.leaves[Math.floor(rnd() * th.leaves.length)];
  // Blob shadow
  const pts = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    pts.push([x + 2 + Math.cos(a) * 9 * s, h + 0.25, y + 2 + Math.sin(a) * 9 * s]);
  }
  b.color('#1e3a1a').face(pts, [0, 1, 0]);
  if (th.trees === 'pine') {
    b.color('#6b4a2e').box(x, h, y, 2.4 * s, 6 * s, 2.4 * s, { bottom: false });
    b.color(leaf).cone(x, h + 5 * s, y, 10 * s, 15 * s, 7).cone(x, h + 13 * s, y, 7 * s, 12 * s, 7);
  } else if (th.trees === 'round') {
    b.color('#5e412a').box(x, h, y, 2.6 * s, 9 * s, 2.6 * s, { bottom: false });
    b.color(leaf).sphere(x, h + 15 * s, y, 8.5 * s, 6, 4);
  } else {
    // Palm: a slightly bent trunk and drooping leaves.
    b.color('#8a6a44');
    for (let k = 0; k < 4; k++) b.box(x + k * 0.9 * s, h + k * 6 * s, y, 2.4 * s, 6.2 * s, 2.4 * s, { bottom: false });
    const tx = x + 3.6 * s;
    const ty = h + 24 * s;
    b.color(leaf);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + rnd() * 0.4;
      const ex = tx + Math.cos(a) * 13 * s;
      const ez = y + Math.sin(a) * 13 * s;
      const px = -Math.sin(a) * 2.2 * s;
      const pz = Math.cos(a) * 2.2 * s;
      const blade = [[tx + px, ty + 1, y + pz], [tx - px, ty + 1, y - pz], [ex, ty - 6 * s, ez]];
      b.face(blade, [0, 1, 0]).face(blade, [0, -1, 0]);
    }
  }
}

// --- Track side ------------------------------------------------------------------------------
// How sharply the track turns around sample i (+ left, - right).
function turnAt(t, i, span = 6) {
  const a = (i - span + t.count) % t.count;
  const c = (i + span) % t.count;
  return t.tx[a] * t.ty[c] - t.ty[a] * t.tx[c];
}

function tyreStacks(b, w) {
  const t = w.t;
  let skip = 0;
  for (let i = 0; i < t.count; i++) {
    if (skip-- > 0) continue;
    const turn = turnAt(t, i);
    if (Math.abs(turn) < 0.35) continue;
    skip = 8;
    // Outside of the bend.
    const side = turn > 0 ? 1 : -1;
    for (let k = 0; k < 3; k++) {
      const off = side * (w.lim + 5);
      const along = (k - 1) * 7;
      const x = t.px[i] - t.ty[i] * off + t.tx[i] * along;
      const z = t.py[i] + t.tx[i] * off + t.ty[i] * along;
      for (let lvl = 0; lvl < 3; lvl++) b.color(lvl === 1 ? '#e8e8e8' : '#1c1c22').cylinder(x, lvl * 2.2, z, 3, 2.2, 8, { top: '#2a2a30' });
    }
  }
}

function billboards(b, w) {
  const t = w.t;
  const colors = w.th.banners;
  let n = 0;
  for (let i = 10; i < t.count; i += 26) {
    if (Math.abs(turnAt(t, i)) > 0.12) continue;
    const side = n % 2 ? 1 : -1;
    const off = side * (w.lim + 18);
    const x = t.px[i] - t.ty[i] * off;
    const z = t.py[i] + t.tx[i] * off;
    const yaw = yawFromDir(t.tx[i], t.ty[i]);
    const P = frame(x, 0, z, yaw);
    for (const lx of [-12, 12]) {
      const [px, , pz] = P(lx, 0, 0);
      b.color('#8a8a92').box(px, 0, pz, 1.2, 8, 1.2);
    }
    const c = colors[n % colors.length];
    b.color(c).orientedBox(x, 8, z, 30, 9, 1, yaw);
    // A simple logo: a white band and a dot in another colour
    b.color('#f4f4f4').orientedBox(x - t.ty[i] * side * 0.6, 11, z + t.tx[i] * side * 0.6, 20, 2.2, 0.2, yaw);
    const [lx2, , lz2] = P(-10, 0, 0);
    b.color(colors[(n + 1) % colors.length]).orientedBox(lx2 - t.ty[i] * side * 0.6, 9.5, lz2 + t.tx[i] * side * 0.6, 5, 5, 0.3, yaw);
    n++;
  }
}

// Grandstand with a crowd along the start straight (outside the barrier).
function grandstand(b, w) {
  const { t, th, lim, rnd } = w;
  const f0 = pointAt(t, t.length * 0.02);
  const yaw = yawFromDir(f0.tx, f0.ty);
  const at = (lat, along = 0) => [f0.x - f0.ty * lat + f0.tx * along, f0.y + f0.tx * lat + f0.ty * along];
  const len = 170;
  const crowd = ['#e63946', '#f4f4f4', '#2a6fdb', '#ffb020', '#3c8a45', '#8a4fb8', '#1c1c28', '#e8c8a0'];
  for (let k = 0; k < 5; k++) {
    const lat = -(lim + 14 + k * 8);
    const [x, z] = at(lat);
    const h = 4 + k * 4;
    b.color(k % 2 ? '#b8b8c0' : '#c4c4cc').orientedBox(x, 0, z, len, h, 8, yaw);
    for (let i = 0; i < 34; i++) {
      if (rnd() < 0.2) continue;
      const [px, pz] = at(lat + 1.5, -len / 2 + 4 + i * ((len - 8) / 33));
      const body = crowd[Math.floor(rnd() * crowd.length)];
      b.color(body).orientedBox(px, h, pz, 2.4, 3.2, 2.4, yaw);
      b.color('#e8c8a0').orientedBox(px, h + 3.2, pz, 1.6, 1.6, 1.6, yaw);
    }
  }
  for (const along of [-len / 2 + 3, 0, len / 2 - 3]) {
    const [x, z] = at(-(lim + 50), along);
    b.color('#8a8a92').orientedBox(x, 0, z, 2, 36, 2, yaw);
  }
  const [rx, rz] = at(-(lim + 32));
  b.color(th.wall[1]).orientedBox(rx, 36, rz, len + 6, 1.5, 44, yaw);
}

// Start/finish: checkered line and a gantry with start lights.
function startGantry(b, w) {
  const { t, th, ROAD_Y } = w;
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
  b.color(th.wall[1]).orientedBox(gx - f0.tx * 1.8, 25, gz - f0.ty * 1.8, 0.5, 5, span * 0.7, yaw);
  for (let k = 0; k < 5; k++) {
    const lat = (k - 2) * 7;
    const [lx, lz] = post(lat);
    b.color('#1c1c24').orientedBox(lx, 35, lz, 3, 5, 5, yaw);
    b.color('#ff3b30', { emissive: 0.8 }).orientedBox(lx - f0.tx * 1.6, 36, lz - f0.ty * 1.6, 0.4, 3, 3, yaw);
  }
}

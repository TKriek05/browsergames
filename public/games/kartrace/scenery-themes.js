// Turbo Kart GP scenery for the big circuits (see scenery.js for the classic
// ones and the track-side details): a harbour town with canal houses, towers,
// cranes and boats; jungle ruins with stepped temples, statues and a waterfall
// at the big jump; a ski village with chalets, a chair lift and snowmen; and
// castles on floating islands with hot-air balloons for the track in the sky.
// Also the shared helpers for placing buildings.
import { yawFromDir } from '../../js/gl/mat4.js';

// --- Helpers --------------------------------------------------------------------------------
// Local frame at (x, y, z) turned by yaw: P(lx, ly, lz) → world point.
export function frame(x, y, z, yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
}

// Direction of a local vector in world space (for face orientation hints).
export function dir(P, lx, ly, lz) {
  const o = P(0, 0, 0);
  const q = P(lx, ly, lz);
  return [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
}

// Gabled roof in a local frame: ridge along local x, eaves at height y0.
export function gable(b, P, w, d, y0, h, roof, wall) {
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  const e = 1.5; // overhang
  b.color(roof);
  b.face([P(x0 - e, y0 - 0.5, z1 + e), P(x1 + e, y0 - 0.5, z1 + e), P(x1 + e, y0 + h, 0), P(x0 - e, y0 + h, 0)], dir(P, 0, 1, 1));
  b.face([P(x0 - e, y0 - 0.5, z0 - e), P(x1 + e, y0 - 0.5, z0 - e), P(x1 + e, y0 + h, 0), P(x0 - e, y0 + h, 0)], dir(P, 0, 1, -1));
  b.color(wall);
  b.face([P(x1, y0, z0), P(x1, y0 + h - 0.3, 0), P(x1, y0, z1)], dir(P, 1, 0, 0));
  b.face([P(x0, y0, z0), P(x0, y0 + h - 0.3, 0), P(x0, y0, z1)], dir(P, -1, 0, 0));
}

// A spot for a building: distance to the track within [minD, maxD], dry,
// free. Its height is the lowest ground under the footprint (the building
// sinks into a slope instead of floating over it).
export function findSpot(w, used, minD, maxD, radius, tries = 60) {
  for (let k = 0; k < tries; k++) {
    const { minX, maxX, minY, maxY } = w.bounds;
    const x = minX - maxD + w.rnd() * (maxX - minX + maxD * 2);
    const y = minY - maxD + w.rnd() * (maxY - minY + maxD * 2);
    const d = w.distToTrack(x, y);
    if (d < minD || d > maxD) continue;
    if (w.lake && Math.hypot(x - w.lake.x, y - w.lake.y) < w.lake.r + radius + 20) continue;
    if (y > w.seaY - 70 - radius) continue;
    if (used.some((u) => Math.hypot(u.x - x, u.y - y) < u.r + radius + 10)) continue;
    let h = w.heightAt(x, y);
    const r = radius * 0.7;
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) h = Math.min(h, w.heightAt(x + dx, y + dy));
    if (h < -2 && !w.th.floating) continue; // not in the water
    used.push({ x, y, r: radius });
    return { x, y, h, yaw: faceTrack(w.t, x, y) };
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

// Buildings for the big circuits' themes; false = not one of them.
export function themeBuildings(b, w, used) {
  const kind = w.th.buildings;
  if (kind === 'city') city(b, w, used);
  else if (kind === 'temple') temples(b, w, used);
  else if (kind === 'ski') skiVillage(b, w, used);
  else if (kind === 'castle') skyCastles(b, w);
  else return false;
  return true;
}

// Trees for the big circuits' themes; false = not one of them.
export function themeTree(b, th, x, h, y, s, rnd, leaf) {
  if (th.trees === 'jungle') {
    // A tall trunk with a crown of broad drooping leaves, ferns at its foot.
    const top = h + (16 + rnd() * 10) * s;
    b.color('#6a5236').box(x, h, y, 2.6 * s, top - h, 2.6 * s, { bottom: false });
    b.color(leaf);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + rnd() * 0.5;
      const ex = x + Math.cos(a) * 12 * s;
      const ez = y + Math.sin(a) * 12 * s;
      const px = -Math.sin(a) * 4 * s;
      const pz = Math.cos(a) * 4 * s;
      const leafFace = [[x + px * 0.3, top + 2, y + pz * 0.3], [x + Math.cos(a) * 6 * s + px, top + 1, y + Math.sin(a) * 6 * s + pz],
        [ex, top - 5 * s, ez], [x + Math.cos(a) * 6 * s - px, top + 1, y + Math.sin(a) * 6 * s - pz], [x - px * 0.3, top + 2, y - pz * 0.3]];
      b.face(leafFace, [0, 1, 0]).face(leafFace, [0, -1, 0]);
    }
    b.color('#2f7a30').sphere(x, top + 1, y, 4 * s, 6, 3);
    b.color('#3f8f36').sphere(x + 4 * s, h + 2 * s, y + 2 * s, 4 * s, 5, 3).sphere(x - 3 * s, h + 1.5 * s, y - 3 * s, 3.4 * s, 5, 3);
    return true;
  }
  if (th.trees === 'snowpine') {
    b.color('#5a4030').box(x, h, y, 2.4 * s, 6 * s, 2.4 * s, { bottom: false });
    b.color(leaf).cone(x, h + 5 * s, y, 10 * s, 13 * s, 7).cone(x, h + 12 * s, y, 7.5 * s, 11 * s, 7);
    b.color('#f4f7fa').cone(x, h + 13.5 * s, y, 7 * s, 4 * s, 7).cone(x, h + 18.5 * s, y, 3.6 * s, 4.5 * s, 7);
    return true;
  }
  return false;
}

// --- Havenstad: canal houses, towers, a quay with cranes, boats -------------------------------
function city(b, w, used) {
  const facades = ['#c9784e', '#e8d8b0', '#8a4a3a', '#f0ebe0', '#5a7a9a', '#d8a860', '#a8c0a0', '#e0b0a0'];
  for (let k = 0; k < 18; k++) {
    const s = findSpot(w, used, w.lim + 70, 420, 14);
    if (!s) continue;
    const c = facades[k % facades.length];
    const floors = 3 + (k % 3);
    const P = frame(s.x, s.h, s.y, s.yaw);
    b.color(c).orientedBox(s.x, s.h, s.y, 12, floors * 6, 16, s.yaw);
    // A stepped gable on the side facing the road, windows in rows.
    const top = floors * 6;
    const [gx, , gz] = P(0, 0, 0);
    b.color(c).orientedBox(gx, s.h + top, gz, 12, 3, 10, s.yaw).orientedBox(gx, s.h + top + 3, gz, 12, 3, 5, s.yaw);
    gable(b, frame(s.x, s.h + top, s.y, s.yaw + Math.PI / 2), 16, 12, 0, 6, '#5a3a32', c);
    for (let f = 0; f < floors; f++) {
      for (const lz of [-4.5, 0, 4.5]) {
        const [wx, , wz] = P(6.1, 0, lz);
        b.color(f === 0 && lz === 0 ? '#3a2a22' : '#f4f0e0').orientedBox(wx, s.h + 1 + f * 6, wz, 0.4, f === 0 && lz === 0 ? 5 : 3.4, 2.4, s.yaw);
      }
    }
  }
  for (let k = 0; k < 5; k++) {
    const s = findSpot(w, used, w.lim + 180, 900, 32);
    if (!s) continue;
    const floors = 9 + k * 3;
    const wall = ['#d8d4cc', '#a8b4c0', '#e8e0d0'][k % 3];
    b.color(wall).orientedBox(s.x, s.h, s.y, 36, floors * 6, 28, s.yaw);
    const P = frame(s.x, s.h, s.y, s.yaw);
    for (let f = 1; f < floors; f++) {
      const [wx, , wz] = P(18.1, 0, 0);
      b.color(f % 2 ? '#6a9ac8' : '#5a8ab8', { emissive: 0.1 }).orientedBox(wx, s.h + f * 6 + 1.5, wz, 0.4, 3, 24, s.yaw);
    }
    b.color('#8a8a92').orientedBox(s.x, s.h + floors * 6, s.y, 38, 1.5, 30, s.yaw);
    b.color('#ff3b30', { emissive: 1 }).box(s.x, s.h + floors * 6 + 1.5, s.y, 1.2, 1.2, 1.2);
  }
  // The quay along the sea: a stone edge, cranes, containers and moored boats.
  const { minX, maxX } = w.bounds;
  const qz = w.seaY - 60;
  for (let x = minX - 200; x < maxX + 200; x += 60) {
    if (w.distToTrack(x, qz) < w.lim + 30) continue;
    b.color('#8a8478').box(x, -4, qz + 30, 60, 4.5, 8);
    b.color('#f4f4f4').box(x + 20, 0.5, qz + 33, 1.2, 2, 1.2);
  }
  const containers = ['#c4452c', '#2a6fdb', '#3c8a45', '#ffb020', '#8a4fb8', '#e8e8e8'];
  let cranes = 0;
  for (let x = minX; x < maxX && cranes < 4; x += 170 + w.rnd() * 60) {
    if (w.distToTrack(x, qz) < w.lim + 70) continue;
    cranes++;
    crane(b, x, w.heightAt(x, qz), qz, cranes);
    for (let k = 0; k < 6; k++) {
      const cx = x + 26 + (k % 3) * 14;
      const cz = qz - 22 - Math.floor(k / 3) * 7;
      const h0 = w.heightAt(cx, cz);
      const stack = 1 + Math.floor(w.rnd() * 3);
      for (let s = 0; s < stack; s++) b.color(containers[(k + s + cranes) % containers.length]).box(cx, h0 + s * 5.2, cz, 12.5, 5, 5.5);
    }
  }
  for (let k = 0; k < 7; k++) {
    const x = minX - 100 + w.rnd() * (maxX - minX + 200);
    boat(b, x, qz + 80 + w.rnd() * 260, k);
  }
}

function crane(b, x, h, z, k) {
  const c = k % 2 ? '#e63946' : '#ffb020';
  for (const [dx, dz] of [[-7, -5], [7, -5], [-7, 5], [7, 5]]) b.color(c).box(x + dx, h, z + dz, 1.6, 26, 1.6);
  b.color(c).box(x, h + 26, z, 17, 3, 12);
  b.color('#3a3a42').box(x + 4, h + 29, z - 4, 7, 5, 6);
  b.color(c).box(x, h + 30, z + 18, 3, 2.4, 70); // the boom out over the water
  b.color('#2a2a30').box(x, h + 14, z + 44, 0.4, 16, 0.4);
  b.color('#5a5a62').box(x, h + 12, z + 44, 5, 2, 12);
}

function boat(b, x, z, k) {
  const hull = ['#f4f4f4', '#c4452c', '#2a4a7a'][k % 3];
  const len = 26 + (k % 3) * 12;
  b.color(hull).box(x, -5, z, len, 5, 9);
  b.color('#8a6a44').box(x, 0, z, len * 0.95, 0.4, 8);
  b.color('#f4f4f4').box(x - len * 0.15, 0.4, z, len * 0.35, 5, 6.5);
  b.color('#5a8ab8').box(x - len * 0.15 + len * 0.176, 2.4, z, 0.3, 2, 5);
  if (k % 2) {
    b.color('#8a8a92').box(x + len * 0.15, 0.4, z, 0.8, 26, 0.8);
    b.color('#f4f4f4').face([[x + len * 0.15 + 0.5, 4, z], [x + len * 0.15 + 0.5, 26, z], [x + len * 0.15 + 12, 4, z]], [0, 0, 1])
      .face([[x + len * 0.15 + 0.5, 4, z], [x + len * 0.15 + 0.5, 26, z], [x + len * 0.15 + 12, 4, z]], [0, 0, -1]);
  }
}

// --- Jungletempel: stepped temples, broken columns, stone heads, a waterfall ----------------------
function temples(b, w, used) {
  const stone = ['#a89a78', '#9a8c6c', '#b4a684'];
  for (let k = 0; k < 3; k++) {
    const s = findSpot(w, used, w.lim + 140, 700, 60);
    if (!s) continue;
    const steps = 5 + k;
    let size = 90 - k * 10;
    let y = s.h - 6;
    for (let i = 0; i < steps; i++) {
      b.color(stone[i % 3], {}).orientedBox(s.x, y, s.y, size, 10, size, s.yaw);
      b.color('#5a7a3a').orientedBox(s.x, y + 10, s.y, size - 1, 0.4, size - 1, s.yaw); // moss on every ledge
      y += 10;
      size -= 12;
    }
    // A shrine on top with a dark doorway, a stair up the front.
    b.color(stone[0]).orientedBox(s.x, y, s.y, size + 4, 12, size + 4, s.yaw);
    const P = frame(s.x, 0, s.y, s.yaw);
    const [dx, , dz] = P((size + 4) / 2 + 0.2, 0, 0);
    b.color('#2a241c').orientedBox(dx, y, dz, 0.4, 8, 5, s.yaw);
    b.color('#c9a25a', { emissive: 0.3 }).orientedBox(s.x, y + 12, s.y, size, 1.5, size, s.yaw);
    for (let i = 0; i < steps; i++) {
      const [sx, , sz] = P(45 - k * 5 - i * 6 + 2, 0, 0);
      b.color('#8a7c5c').orientedBox(sx, s.h - 6 + i * 10, sz, 8, 10, 14, s.yaw);
    }
  }
  for (let k = 0; k < 8; k++) {
    const s = findSpot(w, used, w.lim + 60, 520, 14);
    if (!s) continue;
    if (k % 3 === 0) stoneHead(b, s);
    else ruinColumns(b, s, w.rnd);
  }
  waterfall(b, w);
}

function stoneHead(b, s) {
  const P = frame(s.x, s.h, s.y, s.yaw);
  b.color('#8a8a7a').orientedBox(s.x, s.h - 2, s.y, 12, 18, 10, s.yaw);
  b.color('#7a7a6a').orientedBox(s.x, s.h + 16, s.y, 13, 3, 11, s.yaw);
  const eye = (lz) => {
    const [x, , z] = P(5.1, 0, lz);
    b.color('#2a2a24').orientedBox(x, s.h + 10, z, 0.6, 2, 2.6, s.yaw);
  };
  eye(-2.6);
  eye(2.6);
  const [nx, , nz] = P(6, 0, 0);
  b.color('#8a8a7a').orientedBox(nx, s.h + 5, nz, 2, 5, 2.4, s.yaw);
  const [mx, , mz] = P(5.1, 0, 0);
  b.color('#3a3a30').orientedBox(mx, s.h + 2, mz, 0.6, 1, 5, s.yaw);
}

function ruinColumns(b, s, rnd) {
  const P = frame(s.x, s.h, s.y, s.yaw);
  for (let k = 0; k < 4; k++) {
    const [x, , z] = P(-8 + (k % 2) * 16, 0, -8 + Math.floor(k / 2) * 16);
    const h = 6 + rnd() * 18;
    b.color('#b4a684').cylinder(x, s.h - 1, z, 2.6, h, 8, { top: '#9a8c6c' });
    if (rnd() < 0.5) b.color('#3a8f3a').cylinder(x, s.h + h * 0.4, z, 2.8, 2, 8);
  }
  b.color('#a89a78').orientedBox(s.x, s.h - 1, s.y, 22, 1.5, 22, s.yaw);
}

// Waterfalls beside the big jump: a rock cliff on either side of the drop,
// the river pouring down the face towards the road, a pool with spray below.
function waterfall(b, w) {
  const t = w.t;
  for (const r of t.ramps) {
    const i = r.seg;
    const top = t.pz[i] + 14;
    for (const side of [-1, 1]) {
      const lat0 = side * (w.limAt(i, side) + 46);
      // (along the track, further out from the road, height) → world point
      const Q = (along, off, y) => [t.px[i] + t.tx[i] * along - t.ty[i] * (lat0 + side * off), y, t.py[i] + t.ty[i] * along + t.tx[i] * (lat0 + side * off)];
      const [fx, , fz] = Q(15, -10, 0);
      const foot = Math.min(w.heightAt(fx, fz), top - 44);
      const yaw = yawFromDir(t.tx[i], t.ty[i]);
      // The cliff: stacked rock blocks, a little narrower towards the top.
      const H = top - foot;
      for (let k = 0; k < 3; k++) {
        const [cx, , cz] = Q(15, 30 + k * 4, 0);
        b.color(k % 2 ? '#7a6e58' : '#6a604c').orientedBox(cx, foot - 6, cz, 76 - k * 10, (H * (k + 1)) / 3 + 6, 60 - k * 8, yaw);
      }
      const [tx0, , tz0] = Q(15, 38, 0);
      b.color('#3f8f36').orientedBox(tx0, top, tz0, 56, 1.2, 44, yaw); // jungle on top
      // The water: bands down the face towards the road, bulging out as it falls.
      const toRoad = [side * t.ty[i], 0.2, -side * t.tx[i]];
      const bands = 7;
      for (let k = 0; k < bands; k++) {
        const y0 = top - (H * k) / bands;
        const y1 = top - (H * (k + 1)) / bands;
        const o0 = -0.6 - k * 1.1;
        const o1 = -0.6 - (k + 1) * 1.1;
        b.color(k % 2 ? '#8fd8f0' : '#bfeaf8', { emissive: 0.35 })
          .face([Q(-2 - k, o0, y0), Q(32 + k, o0, y0), Q(33 + k, o1, y1), Q(-3 - k, o1, y1)], toRoad);
      }
      const [px, , pz] = Q(15, -18, 0);
      b.color('#5ac0e0', { emissive: 0.15 }).cylinder(px, foot - 1, pz, 22, 1.4, 12, { top: '#6acce8' });
      for (let k = 0; k < 5; k++) {
        const [mx, , mz] = Q(2 + k * 7, -8 - (k % 2) * 5, 0);
        b.color('#f4fbff', { emissive: 0.4 }).sphere(mx, foot + 3 + (k % 3) * 2, mz, 5 + (k % 3) * 2, 6, 3);
      }
    }
  }
}

// --- Sneeuwtop: chalets, a chair lift, snowmen --------------------------------------------------
function skiVillage(b, w, used) {
  const walls = ['#7a4f2e', '#8a5a34', '#6a4428'];
  for (let k = 0; k < 9; k++) {
    const s = findSpot(w, used, w.lim + 70, 560, 18);
    if (!s) continue;
    const c = walls[k % 3];
    const P = frame(s.x, s.h, s.y, s.yaw);
    b.color('#8a8a92').orientedBox(s.x, s.h - 2, s.y, 22, 5, 16, s.yaw);
    b.color(c).orientedBox(s.x, s.h + 3, s.y, 22, 9, 16, s.yaw);
    gable(b, frame(s.x, s.h + 3, s.y, s.yaw), 22, 16, 9, 8, '#f4f7fa', c);
    const [bx, , bz] = P(11.2, 0, 0);
    b.color('#6a4428').orientedBox(bx, s.h + 7, bz, 1.2, 0.8, 16, s.yaw); // balcony
    for (const lz of [-5, 5]) {
      const [wx, , wz] = P(11.1, 0, lz);
      b.color('#ffd27a', { emissive: 0.5 }).orientedBox(wx, s.h + 5, wz, 0.4, 3, 3, s.yaw);
    }
  }
  for (let k = 0; k < 6; k++) {
    const s = findSpot(w, used, w.lim + 40, 360, 5);
    if (!s) continue;
    b.color('#ffffff').sphere(s.x, s.h + 4, s.y, 4.5, 7, 4).sphere(s.x, s.h + 10.5, s.y, 3.2, 7, 4).sphere(s.x, s.h + 15, s.y, 2.2, 6, 4);
    const [nx, , nz] = frame(s.x, 0, s.y, s.yaw)(2.2, 0, 0);
    b.color('#ff7a1a').cone(nx, s.h + 15, nz, 0.5, 2.4, 4);
    b.color('#c4452c').cylinder(s.x, s.h + 12.8, s.y, 2.8, 1.2, 8);
  }
  chairLift(b, w, used);
}

// A chair lift from the valley up the mountain: pylons, a cable, chairs.
function chairLift(b, w, used) {
  const bottom = findSpot(w, used, w.lim + 120, 700, 16);
  if (!bottom) return;
  // The top: the highest free spot in a few tries.
  let top = null;
  for (let k = 0; k < 40; k++) {
    const a = w.rnd() * Math.PI * 2;
    const d = 500 + w.rnd() * 500;
    const x = bottom.x + Math.cos(a) * d;
    const y = bottom.y + Math.sin(a) * d;
    const dt = w.distToTrack(x, y);
    if (dt < w.lim + 120) continue;
    const h = w.heightAt(x, y);
    if (!top || h > top.h) top = { x, y, h };
  }
  if (!top || top.h < bottom.h + 60) return;
  const n = 7;
  const cable = [];
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    const x = bottom.x + (top.x - bottom.x) * u;
    const y = bottom.y + (top.y - bottom.y) * u;
    if (w.distToTrack(x, y) < w.lim + 20) return; // never over the road
    const g = w.heightAt(x, y);
    b.color('#8a8a92').box(x, g, y, 2, 28, 2);
    b.color('#5a5a62').box(x, g + 28, y, 10, 1.2, 1.2);
    cable.push([x, g + 27, y]);
  }
  b.color('#6a4428').box(bottom.x, bottom.h, bottom.y, 20, 10, 16).box(top.x, top.h, top.y, 20, 10, 16);
  b.color('#2a2a30');
  for (let k = 0; k < n; k++) {
    const [ax, ay, az] = cable[k];
    const [cx, cy, cz] = cable[k + 1];
    b.face([[ax, ay, az], [cx, cy, cz], [cx, cy + 0.4, cz]], [0, 1, 0]).face([[ax, ay, az], [cx, cy + 0.4, cz], [ax, ay + 0.4, az]], [0, -1, 0]);
    for (let c = 1; c < 4; c++) {
      const u = c / 4;
      const x = ax + (cx - ax) * u;
      const y = ay + (cy - ay) * u;
      const z = az + (cz - az) * u;
      b.color('#2a2a30').box(x, y - 5, z, 0.3, 5, 0.3);
      b.color(c % 2 ? '#e63946' : '#2a6fdb').box(x, y - 7, z, 4, 1.2, 3);
    }
  }
}

// --- Wolkenpaleis: floating islands with castles, balloons ---------------------------------------
function skyCastles(b, w) {
  const { t, rnd } = w;
  const { minX, maxX, minY, maxY } = w.bounds;
  const roofs = ['#f7b8d0', '#b8d8ff', '#ffe08a', '#c8b8f0'];
  let placed = 0;
  for (let tries = 0; tries < 200 && placed < 14; tries++) {
    const x = minX - 500 + rnd() * (maxX - minX + 1000);
    const z = minY - 500 + rnd() * (maxY - minY + 1000);
    const d = w.distToTrack(x, z);
    const r = 50 + rnd() * 70;
    if (d < w.lim + r + 60 || d > 1100) continue;
    placed++;
    const y = -40 + rnd() * 120;
    island(b, x, y, z, r, rnd);
    if (placed % 2) castle(b, x, y, z, r * 0.55, roofs[placed % roofs.length], rnd);
    else for (let k = 0; k < 3; k++) tower(b, x + (k - 1) * r * 0.4, y, z + (rnd() - 0.5) * r * 0.5, 5 + rnd() * 3, 20 + rnd() * 20, roofs[(placed + k) % roofs.length]);
  }
  // The palace behind the start: a big island with the main castle.
  const at = { x: t.px[0] - t.ty[0] * -(w.limAt(0, -1) + 340), z: t.py[0] + t.tx[0] * -(w.limAt(0, -1) + 340) };
  island(b, at.x, -10, at.z, 170, rnd);
  castle(b, at.x, -10, at.z, 100, roofs[0], rnd);
  for (let k = 0; k < 9; k++) {
    const x = minX - 300 + rnd() * (maxX - minX + 600);
    const z = minY - 300 + rnd() * (maxY - minY + 600);
    if (w.distToTrack(x, z) < w.lim + 80) continue;
    balloon(b, x, 90 + rnd() * 140, z, roofs[k % roofs.length]);
  }
}

// A floating island: a grassy disc on an upside-down cone of rock.
function island(b, x, y, z, r, rnd) {
  b.color('#ffffff').cylinder(x, y - 3, z, r, 3, 12, { top: '#c8f0c8' });
  b.color('#b8a8c8').cone(x, y - 3, z, r, -r * 0.9, 12);
  b.color('#a898b8').cone(x + r * 0.2, y - 3, z - r * 0.1, r * 0.6, -r * 1.2, 8);
  for (let k = 0; k < 5; k++) {
    const a = rnd() * Math.PI * 2;
    b.color('#f4f0f8', { emissive: 0.2 }).sphere(x + Math.cos(a) * r, y - 6, z + Math.sin(a) * r, r * 0.22, 6, 3);
  }
}

function tower(b, x, y, z, r, h, roof) {
  b.color('#f4f0f8').cylinder(x, y, z, r, h, 10, { top: '#e8e0f0' });
  b.color('#d8d0e4').cylinder(x, y + h, z, r + 1, 2.5, 10);
  b.color(roof).cone(x, y + h + 2.5, z, r + 1.5, r * 2.4, 10);
  b.color('#6a8ac8', { emissive: 0.3 }).box(x + r - 0.2, y + h * 0.6, z, 0.6, 3.5, 2);
}

function castle(b, x, y, z, s, roof, rnd) {
  b.color('#f4f0f8').box(x, y, z, s, s * 0.45, s, { top: '#e8e0f0' });
  for (let k = 0; k < 8; k++) {
    const u = (k / 8) * 2 - 1 + 1 / 8;
    b.color('#e8e0f0').box(x + u * s * 0.5, y + s * 0.45, z - s / 2, s / 16, 2.5, 1.5).box(x + u * s * 0.5, y + s * 0.45, z + s / 2, s / 16, 2.5, 1.5);
  }
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) tower(b, x + (dx * s) / 2, y, z + (dz * s) / 2, s * 0.1, s * 0.7, roof);
  tower(b, x, y + s * 0.45, z, s * 0.16, s * 0.6 + rnd() * s * 0.2, roof);
  b.color('#8a6a9a').box(x + s / 2 + 0.2, y, z, 0.6, s * 0.22, s * 0.14);
}

function balloon(b, x, y, z, c) {
  b.color(c).sphere(x, y, z, 14, 8, 5);
  b.color('#f4f4f4').cylinder(x, y - 13, z, 6, 3, 8);
  b.color('#6a4a2e').box(x, y - 26, z, 6, 5, 6);
  b.color('#5a5a62');
  for (const [dx, dz] of [[-2.6, -2.6], [2.6, 2.6]]) b.box(x + dx, y - 21, z + dz, 0.3, 8, 0.3);
}

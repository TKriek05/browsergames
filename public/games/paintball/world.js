// Spetterveld: the static world of a field in one mesh (ground, lines, fence
// poles, every solid in its own style, scenery outside the net) plus the
// see-through net. Game (x, y, z) → 3D (x, z, y). Seeded: same field, same world.
// The big fields with height draw their solids in world-levels.js.
import { MeshBuilder } from '../../js/gl/mesh.js';
import { createRng } from '../../../shared/rng.js';
import { PB_LEVELS } from '../../../shared/maps/paintball-levels.js';
import { extraObstacle, havenSurroundings, avondSurroundings } from './world-extra.js';
import { levelSolid, levelSurroundings } from './world-levels.js';

let W = 420;
let H = 280;
// The net is higher than anything you can stand on.
const netHeight = (arena) => Math.max(38, ...arena.solids.map((o) => o.z1 + 14));

export function buildWorld(arena, th) {
  const b = new MeshBuilder();
  const rnd = createRng(arena.key.length * 977 + 13);
  W = arena.width;
  H = arena.height;
  const NET_H = netHeight(arena);
  const big = !!PB_LEVELS[arena.key];

  // --- Ground --------------------------------------------------------------------------
  b.color(th.outside).face([[-600, -0.05, -500], [-600, -0.05, H + 500], [W + 600, -0.05, H + 500], [W + 600, -0.05, -500]], [0, 1, 0]);
  const band = 30;
  for (let x = 0; x < W; x += band) {
    b.color(th.field[(x / band) % 2]).face([[x, 0, 0], [x, 0, H], [Math.min(W, x + band), 0, H], [Math.min(W, x + band), 0, 0]], [0, 1, 0]);
  }
  if (th.lines) {
    b.color(th.lines);
    const line = (x0, y0, x1, y1) => b.face([[x0, 0.03, y0], [x0, 0.03, y1], [x1, 0.03, y1], [x1, 0.03, y0]], [0, 1, 0]);
    line(3, 3, W - 3, 4); line(3, H - 4, W - 3, H - 3); line(3, 3, 4, H - 3); line(W - 4, 3, W - 3, H - 3);
    line(W / 2 - 0.6, 3, W / 2 + 0.6, H - 3);
  } else {
    // Worn patches on the forest floor / farmyard.
    for (let i = 0; i < 26; i++) {
      const x = 20 + rnd() * (W - 40);
      const y = 20 + rnd() * (H - 40);
      const r = 8 + rnd() * 16;
      b.color(i % 2 ? th.field[1] : shade(th.field[0], -0.08));
      const pts = [];
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const rr = r * (0.7 + rnd() * 0.3);
        pts.push([x + Math.cos(a) * rr, 0.02, y + Math.sin(a) * rr]);
      }
      b.face(pts, [0, 1, 0]);
    }
  }

  // --- Fence poles + top rope -----------------------------------------------------------
  b.color('#3a3a36');
  for (let x = 0; x <= W; x += 35) {
    b.cylinder(x, 0, -1, 0.7, NET_H, 5).cylinder(x, 0, H + 1, 0.7, NET_H, 5);
  }
  for (let y = 35; y < H; y += 35) {
    b.cylinder(-1, 0, y, 0.7, NET_H, 5).cylinder(W + 1, 0, y, 0.7, NET_H, 5);
  }

  // --- Solids -----------------------------------------------------------------------------------
  arena.solids.forEach((o, i) => {
    if (big && levelSolid(b, o, i, th, rnd)) return;
    obstacle(b, { ...o, hgt: o.z1 }, i, th, rnd);
  });

  // --- Scenery outside ------------------------------------------------------------------------
  if (big) levelSurroundings(b, arena, th, rnd);
  else if (arena.key === 'opblaas') speedballSurroundings(b, th, rnd);
  else if (arena.key === 'bos') forestSurroundings(b, th, rnd);
  else if (arena.key === 'haven') havenSurroundings(b, th, rnd);
  else if (arena.key === 'avond') avondSurroundings(b, th, rnd);
  else farmSurroundings(b, th, rnd);
  return b.build();
}

// The net: drawn see-through on top of everything else.
export function buildNet(arena, th) {
  const b = new MeshBuilder();
  const w = arena.width;
  const h = arena.height;
  b.color(th.net);
  b.wall([[0, -1], [w, -1], [w + 1, 0], [w + 1, h], [w, h + 1], [0, h + 1], [-1, h], [-1, 0]], 0, netHeight(arena), true);
  return b.build();
}

// --- Obstacles ------------------------------------------------------------------------------
function obstacle(b, o, i, th, rnd) {
  const h = o.hgt;
  switch (o.kind) {
    case 'bunker': {
      const c = th.bunkers[i % th.bunkers.length];
      b.color(c).box(o.x, 0, o.y, o.w, h - 2, o.h);
      b.color(shade(c, 0.12)).box(o.x, h - 2, o.y, o.w - 2, 2, o.h - 2); // puffy top
      b.color(th.trim).box(o.x, h * 0.55, o.y, o.w + 0.3, 1.2, o.h + 0.3); // seam
      break;
    }
    case 'can': {
      const c = th.cans[i % th.cans.length];
      b.color(c).cylinder(o.x, 0, o.y, o.r, h, 12, { top: shade(c, 0.15) });
      b.color(th.trim).cylinder(o.x, h * 0.35, o.y, o.r + 0.2, 1.2, 12);
      b.color(th.trim).cylinder(o.x, h * 0.72, o.y, o.r + 0.2, 1.2, 12);
      break;
    }
    case 'tree':
      tree(b, o.x, o.y, o.r, h, th, rnd);
      break;
    case 'pallet': {
      const planks = 6;
      for (let k = 0; k < planks; k++) {
        b.color(th.wood[k % 2]).box(o.x, (k * h) / planks, o.y, o.w, h / planks - 0.4, o.h);
        b.color('#5a4128').box(o.x, (k * h) / planks + h / planks - 0.4, o.y, o.w - 1, 0.4, o.h - 1);
      }
      break;
    }
    case 'logs': {
      const alongX = o.w >= o.h;
      const len = alongX ? o.w : o.h;
      const across = alongX ? o.h : o.w;
      const r = across / 4;
      let row = 0;
      for (let y = r; y < h; y += r * 1.8, row++) {
        for (let k = 0; k < 2; k++) {
          const off = (k - 0.5) * r * 2 + (row % 2 ? r * 0.3 : 0);
          b.color(k % 2 ? '#7a5634' : '#6a4a2c');
          log(b, alongX ? o.x : o.x + off, y, alongX ? o.y + off : o.y, r, len, alongX);
        }
      }
      break;
    }
    case 'hut': {
      b.color(th.wood[0]).box(o.x, 0, o.y, o.w, h - 8, o.h);
      b.color('#3b2a1a').box(o.x - o.w / 2 - 0.05, 0, o.y, 0.2, 18, 8); // door
      b.color('#3b2a1a').box(o.x + o.w / 2 + 0.05, 8, o.y, 0.2, 8, 10); // window
      roof(b, o.x, h - 8, o.y, o.w + 4, 9, o.h + 4, th.roof);
      break;
    }
    case 'hay': {
      b.color(th.hay[i % 2]).box(o.x, 0, o.y, o.w, h, o.h, { top: shade(th.hay[0], 0.08) });
      b.color('#8a6a2a');
      const alongX = o.w >= o.h;
      for (const t of [-0.25, 0.25]) {
        if (alongX) b.box(o.x + t * o.w, 0, o.y, 0.6, h + 0.1, o.h + 0.2);
        else b.box(o.x, 0, o.y + t * o.h, o.w + 0.2, h + 0.1, 0.6);
      }
      break;
    }
    case 'crate': {
      b.color(th.wood[1]).box(o.x, 0, o.y, o.w, h, o.h, { top: th.wood[0] });
      b.color('#5a4128');
      b.box(o.x, 0, o.y, o.w + 0.3, 1.2, o.h + 0.3).box(o.x, h - 1.2, o.y, o.w + 0.3, 1.2, o.h + 0.3);
      break;
    }
    case 'barn': {
      b.color(th.barn).box(o.x, 0, o.y, o.w, h, o.h);
      b.color('#f2efe6').box(o.x, h - 1.5, o.y, o.w + 0.4, 1.5, o.h + 0.4);
      for (let x = o.x - o.w / 2 + 6; x < o.x + o.w / 2; x += 12) b.color(shade(th.barn, -0.15)).box(x, 0, o.y, 0.6, h - 1.5, o.h + 0.2);
      break;
    }
    case 'tank': {
      b.color(th.metal[0]).cylinder(o.x, 0, o.y, o.r, h, 14, { top: th.metal[1] });
      b.color(th.metal[1]);
      for (const y of [h * 0.3, h * 0.65]) b.cylinder(o.x, y, o.y, o.r + 0.3, 1, 14);
      b.color('#5d7280').cone(o.x, h, o.y, o.r, 5, 14);
      break;
    }
    case 'wagon': {
      b.color(th.wood[0]).box(o.x, 5, o.y, o.w, h - 5, o.h, { top: th.hay[0] });
      b.color('#3a3a36');
      for (const dx of [-o.w / 3, o.w / 3]) {
        b.wheel(o.x + dx, 4, o.y - o.h / 2 - 0.8, 4, 1.4, 10, '#6a6a60');
        b.wheel(o.x + dx, 4, o.y + o.h / 2 + 0.8, 4, 1.4, 10, '#6a6a60');
      }
      break;
    }
    case 'barrel': {
      b.color('#9a4a2a').cylinder(o.x, 0, o.y, o.r, h, 10, { top: '#7a3a22' });
      b.color('#3a3a36');
      for (const y of [2, h / 2, h - 3]) b.cylinder(o.x, y, o.y, o.r + 0.2, 0.8, 10);
      break;
    }
    default:
      if (extraObstacle(b, o, i, th, rnd)) break;
      b.color('#888888');
      if (o.t === 'can') b.cylinder(o.x, 0, o.y, o.r, h, 10);
      else b.box(o.x, 0, o.y, o.w, h, o.h);
  }
}

function tree(b, x, y, r, h, th, rnd) {
  b.color(th.bark ?? '#6b4a2b').cylinder(x, 0, y, r, h * 0.55, 7);
  const leaves = th.leaves ?? ['#3f7f3a', '#2f6b32'];
  const layers = 3;
  for (let k = 0; k < layers; k++) {
    const base = h * (0.35 + k * 0.18);
    const rr = r * (4.2 - k * 1.1) + rnd() * 2;
    b.color(leaves[k % leaves.length]).cone(x, base, y, rr, h * 0.34, 7);
  }
}

// Cylinder lying along x (alongX) or z, centre (x, y, z).
function log(b, x, y, z, r, len, alongX) {
  const seg = 7;
  const pts = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const P = (u, v, w) => (alongX ? [x + w, y + v, z + u] : [x + u, y + v, z + w]);
  for (let i = 0; i < seg; i++) {
    const [au, av] = pts[i];
    const [bu, bv] = pts[(i + 1) % seg];
    const n = alongX ? [0, (av + bv) / 2, (au + bu) / 2] : [(au + bu) / 2, (av + bv) / 2, 0];
    b.face([P(au, av, -len / 2), P(bu, bv, -len / 2), P(bu, bv, len / 2), P(au, av, len / 2)], n);
  }
  b.color('#c9a574');
  b.face(pts.map(([u, v]) => P(u, v, len / 2)), alongX ? [1, 0, 0] : [0, 0, 1]);
  b.face(pts.map(([u, v]) => P(u, v, -len / 2)), alongX ? [-1, 0, 0] : [0, 0, -1]);
}

// Gable roof along x over a w × d footprint.
function roof(b, x, y, z, w, rise, d, color) {
  b.color(color);
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
  b.face([[x0, y, z0], [x1, y, z0], [x1, y + rise, z], [x0, y + rise, z]], [0, 1, -1]);
  b.face([[x0, y, z1], [x0, y + rise, z], [x1, y + rise, z], [x1, y, z1]], [0, 1, 1]);
  b.color(shade(color, 0.1));
  b.face([[x0, y, z0], [x0, y + rise, z], [x0, y, z1]], [-1, 0, 0]);
  b.face([[x1, y, z0], [x1, y, z1], [x1, y + rise, z]], [1, 0, 0]);
}

// --- Surroundings ------------------------------------------------------------------------------
function ringSpots(rnd, n, margin, spread) {
  const spots = [];
  for (let i = 0; i < n; i++) {
    const side = Math.floor(rnd() * 4);
    const t = rnd();
    const d = margin + rnd() * spread;
    if (side === 0) spots.push([-40 + t * (W + 80), -d]);
    else if (side === 1) spots.push([-40 + t * (W + 80), H + d]);
    else if (side === 2) spots.push([-d, -40 + t * (H + 80)]);
    else spots.push([W + d, -40 + t * (H + 80)]);
  }
  return spots;
}

function speedballSurroundings(b, th, rnd) {
  // Team tents on both ends, flags, bleachers along the side, a tree line.
  for (const [x, c] of [[-45, '#e63946'], [W + 45, '#1d6fd8']]) {
    for (const y of [60, 140, 220]) {
      b.color('#f2f2ee').box(x, 0, y, 26, 12, 26);
      b.color(c).cone(x, 12, y, 20, 10, 4);
    }
    b.color('#3a3a36').cylinder(x, 0, 10, 0.5, 40, 5);
    b.color(c).box(x + 5, 32, 10, 10, 7, 0.4);
  }
  for (let x = 40; x < W - 20; x += 50) {
    for (let row = 0; row < 3; row++) b.color(row % 2 ? '#c8ccd2' : '#aeb4bc').box(x, row * 4, -26 - row * 6, 44, 4, 6);
  }
  for (const [x, y] of ringSpots(rnd, 40, 90, 260)) tree(b, x, y, 3 + rnd() * 2, 40 + rnd() * 30, { bark: '#6b4a2b', leaves: ['#3f7f3a', '#4d8c3f', '#35713a'] }, rnd);
}

function forestSurroundings(b, th, rnd) {
  for (const [x, y] of ringSpots(rnd, 150, 18, 300)) tree(b, x, y, 3 + rnd() * 3, 50 + rnd() * 40, th, rnd);
  b.color('#3d6a2e');
  for (const [x, y] of ringSpots(rnd, 50, 8, 60)) b.sphere(x, 1, y, 4 + rnd() * 4, 6, 4);
}

function farmSurroundings(b, th, rnd) {
  // A big barn and the farmhouse, a wooden fence and crop fields.
  b.color(th.barn).box(W / 2, 0, -90, 120, 34, 60);
  roof(b, W / 2, 34, -90, 128, 22, 66, '#4a4a4a');
  b.color('#f2efe6').box(W / 2, 0, -59.8, 30, 26, 0.4);
  b.color('#e9e2d0').box(-90, 0, H / 2, 50, 26, 70);
  roof(b, -90, 26, H / 2, 56, 16, 76, '#8a3a2a');
  b.color(th.wood[1]);
  for (let x = -60; x <= W + 60; x += 12) b.box(x, 0, H + 40, 1.2, 10, 1.2);
  b.box(W / 2, 6, H + 40, W + 120, 1.2, 0.8).box(W / 2, 3, H + 40, W + 120, 1.2, 0.8);
  for (let k = 0; k < 14; k++) {
    b.color(k % 2 ? '#8fb04a' : '#7a9a3c').face([[-200, 0.01, H + 60 + k * 14], [-200, 0.01, H + 72 + k * 14], [W + 200, 0.01, H + 72 + k * 14], [W + 200, 0.01, H + 60 + k * 14]], [0, 1, 0]);
  }
  for (const [x, y] of ringSpots(rnd, 30, 150, 250)) tree(b, x, y, 3 + rnd() * 2, 45 + rnd() * 25, { bark: '#6b4a2b', leaves: ['#4d8c3f', '#5a9a44'] }, rnd);
}

// Lighten (amount > 0) or darken a hex colour.
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(amount > 0 ? v + (255 - v) * amount : v * (1 + amount))));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('')}`;
}

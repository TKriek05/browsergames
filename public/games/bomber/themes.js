// Boemstad map themes: the look of each map (shared/maps/bomber-arenas.js).
// Per theme: sky/fog/light, the floor, the world around the arena, the fixed
// walls (by their layout character) and the destructible blocks.
//   stad    – a Dutch village: brick houses, stone posts, tulips and a windmill
//   park    – a city park: hedges, trees, a pond, bushes to blow up
//   haven   – a harbour: containers, a canal, crates and barrels, cranes and a ship
//   kasteel – a castle: battlements, towers, hay bales, a moat
//   winter  – a snowy village: pines, a frozen pond, snowmen
import { BOMB_COLS, BOMB_ROWS, BTILE, BOMB_WORLD } from '../../../shared/games/bomber.js';

const W = BOMB_WORLD.width;
const H = BOMB_WORLD.height;
const CX = W / 2;
const CZ = H / 2;

const seeded = (seed) => {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
};

// Ground far around the arena (just below the floor: no z-fighting), then the floor tiles.
function ground(b, outside, tile) {
  b.color(outside).box(CX, -2.2, CZ, W + 600, 2, H + 500);
  for (let y = 0; y < BOMB_ROWS; y++) {
    for (let x = 0; x < BOMB_COLS; x++) {
      b.color(tile(x, y));
      b.face([[x * BTILE, 0, y * BTILE], [x * BTILE, 0, y * BTILE + BTILE], [x * BTILE + BTILE, 0, y * BTILE + BTILE], [x * BTILE + BTILE, 0, y * BTILE]], [0, 1, 0]);
    }
  }
}

// Scattered positions around the arena (not on it).
function around(rnd, n, fn) {
  for (let i = 0; i < n; i++) {
    const side = i % 4;
    const along = rnd();
    const out = 40 + rnd() * 120;
    const x = side === 0 ? -out : side === 1 ? W + out : along * (W + 240) - 120;
    const z = side === 2 ? -out : side === 3 ? H + out : along * (H + 200) - 100;
    fn(x, z, 0.8 + rnd() * 0.5, i);
  }
}

function tree(b, x, z, s, leaf = '#3c8a45') {
  b.color('#6b4a2e').box(x, 0, z, 2.4 * s, 8 * s, 2.4 * s, { bottom: false });
  b.color(leaf).sphere(x, 13 * s, z, 7.5 * s, 6, 4);
}

function pine(b, x, z, s, snow = false) {
  b.color('#6b4a2e').box(x, 0, z, 2.2 * s, 5 * s, 2.2 * s, { bottom: false });
  b.color(snow ? '#e8f0f6' : '#2f6a3a').cone(x, 4 * s, z, 8 * s, 10 * s, 7);
  b.color(snow ? '#f8fbff' : '#3a7a44').cone(x, 11 * s, z, 6 * s, 9 * s, 7);
}

// Gabled roof with its ridge along x: two slopes and two triangular ends.
export function gable(b, x, y, z, w, d, h, roof, wall) {
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
  b.color(roof);
  b.face([[x0, y, z1], [x1, y, z1], [x1, y + h, z], [x0, y + h, z]], [0, 1, 1]);
  b.face([[x0, y, z0], [x0, y + h, z], [x1, y + h, z], [x1, y, z0]], [0, 1, -1]);
  b.color(wall);
  b.face([[x1 - 0.5, y, z0 + 0.5], [x1 - 0.5, y + h - 0.4, z], [x1 - 0.5, y, z1 - 0.5]], [1, 0, 0]);
  b.face([[x0 + 0.5, y, z0 + 0.5], [x0 + 0.5, y, z1 - 0.5], [x0 + 0.5, y + h - 0.4, z]], [-1, 0, 0]);
}

// A water (or ice) tile on top of a low rim of height y.
function water(b, cx, cz, color, ice = false, y = 0.5) {
  b.color(color, { emissive: ice ? 0.15 : 0.08 }).face([[cx - 8, y + 0.05, cz - 8], [cx - 8, y + 0.05, cz + 8], [cx + 8, y + 0.05, cz + 8], [cx + 8, y + 0.05, cz - 8]], [0, 1, 0]);
  b.color('#ffffff', { emissive: 0.3 }).box(cx - 3, y + 0.08, cz + 2, 5, 0.05, 0.6, { bottom: false });
}

// --- Themes ------------------------------------------------------------------------------------
export const THEMES = {
  stad: {
    colors: { sky: ['#4a93d8', '#d8ecf8'], fog: ['#cfe0c8', 520, 1100], light: { dir: [-0.4, -1, -0.5], color: '#ece2c8', ambient: '#6a7066' } },
    world(b) {
      const rnd = seeded(4242);
      ground(b, '#5f9a45', (x, y) => ((x + y) % 2 ? '#78b556' : '#70ad4f'));
      // A brick road around the town wall, then trees and tulip fields.
      b.color('#b8a58a');
      for (const [x, z, w, d] of [[CX, -14, W + 56, 20], [CX, H + 14, W + 56, 20], [-14, CZ, 20, H + 8], [W + 14, CZ, 20, H + 8]]) {
        b.face([[x - w / 2, 0.05, z - d / 2], [x - w / 2, 0.05, z + d / 2], [x + w / 2, 0.05, z + d / 2], [x + w / 2, 0.05, z - d / 2]], [0, 1, 0]);
      }
      const tulips = ['#e63946', '#ffb020', '#f4f4f4', '#d94f9a'];
      around(rnd, 70, (x, z, s, i) => {
        if (rnd() < 0.6) tree(b, x, z, s, ['#3c8a45', '#4a9a4a', '#2f7a3b'][i % 3]);
        else {
          b.color(tulips[i % tulips.length]);
          for (let k = 0; k < 4; k++) b.box(x + (k - 1.5) * 5, 0, z, 3, 1.2, 14, { bottom: false });
        }
      });
      // A canal with a little bridge along the north side, and a windmill.
      b.color('#3a78b0', { emissive: 0.08 }).face([[-300, -0.6, -70], [-300, -0.6, -46], [W + 300, -0.6, -46], [W + 300, -0.6, -70]], [0, 1, 0]);
      b.color('#6a5a48').box(CX, -2, -46, W + 600, 2.2, 2).box(CX, -2, -70, W + 600, 2.2, 2);
      b.color('#9a4a36').box(CX, 0, -58, 24, 3, 30, { top: '#a8503a' });
      const mx = W + 90;
      const mz = -20;
      b.color('#5e4a3a').cylinder(mx, 0, mz, 10, 34, 8, { top: '#4a3a2e' });
      b.color('#6a6a3a').cone(mx, 34, mz, 11, 11, 8);
      b.color('#e8e0d0');
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.3;
        const q = (along, across) => [mx - 11, 36 + Math.cos(a) * along - Math.sin(a) * across, mz + Math.sin(a) * along + Math.cos(a) * across];
        const blade = [q(3, -1.4), q(30, -3), q(30, 3), q(3, 1.4)];
        b.face(blade, [-1, 0, 0]).face(blade, [1, 0, 0]);
      }
    },
    border(b, cx, cz) {
      // Town wall in red brick with a stone coping.
      b.color('#9a4a36').box(cx, 0, cz, BTILE, 12, BTILE, { top: '#a8503a', bottom: false });
      b.color('#c8bcaa').box(cx, 12, cz, BTILE - 6, 0.6, BTILE - 6, { bottom: false });
      b.color('#7e3a2a').box(cx, 6, cz, BTILE + 0.3, 0.8, BTILE + 0.3, { bottom: false });
    },
    wall(b, cx, cz) {
      // Stone posts.
      b.color('#8a8a92').box(cx, 0, cz, BTILE, 14, BTILE, { top: '#a2a2aa', bottom: false });
      b.color('#74747c').box(cx, 4.6, cz, BTILE + 0.3, 0.8, BTILE + 0.3, { bottom: false }).box(cx, 9.2, cz, BTILE + 0.3, 0.8, BTILE + 0.3, { bottom: false });
    },
    // Destructible blocks: little Dutch houses with a gabled roof and windows.
    block(b, cx, cz, k) {
      const bricks = ['#b5553c', '#a0472f', '#c9784e', '#d8c8a8'];
      const roofs = ['#6a2a22', '#3a3a44', '#8a3a2a'];
      b.color(bricks[k % bricks.length]).box(cx, 0, cz, 13, 8, 13, { bottom: false });
      gable(b, cx, 8, cz, 14, 14, 6, roofs[k % roofs.length], bricks[k % bricks.length]);
      b.color('#f4f4f4').box(cx - 3, 3.6, cz + 6.55, 3.2, 3.2, 0.3, { bottom: false }).box(cx + 3, 3.6, cz + 6.55, 3.2, 3.2, 0.3, { bottom: false });
      b.color('#7fb0d8').box(cx - 3, 4, cz + 6.75, 2.2, 2.4, 0.2, { bottom: false }).box(cx + 3, 4, cz + 6.75, 2.2, 2.4, 0.2, { bottom: false });
      b.color('#2f5a3a').box(cx + 6.55, 0, cz, 0.3, 5.5, 3, { bottom: false });
    },
  },

  park: {
    colors: { sky: ['#3f8fd8', '#dff0fa'], fog: ['#d6e8cc', 520, 1100], light: { dir: [-0.5, -1, -0.35], color: '#f2ead0', ambient: '#687a66' } },
    world(b) {
      const rnd = seeded(777);
      ground(b, '#6aa84e', (x, y) => ((x + y) % 2 ? '#8cc26a' : '#84ba62'));
      // Gravel path around the park, benches, lamp posts, lots of trees and a fountain.
      b.color('#d8c8a0');
      for (const [x, z, w, d] of [[CX, -16, W + 60, 18], [CX, H + 16, W + 60, 18], [-16, CZ, 18, H + 14], [W + 16, CZ, 18, H + 14]]) {
        b.face([[x - w / 2, 0.05, z - d / 2], [x - w / 2, 0.05, z + d / 2], [x + w / 2, 0.05, z + d / 2], [x + w / 2, 0.05, z - d / 2]], [0, 1, 0]);
      }
      around(rnd, 80, (x, z, s, i) => tree(b, x, z, s * 1.2, ['#3c8a45', '#58a04a', '#2f7a3b', '#6aa84e'][i % 4]));
      for (const [x, z] of [[40, -30], [W - 40, -30], [40, H + 30], [W - 40, H + 30]]) {
        b.color('#8a5a34').box(x, 2.4, z, 18, 1, 5).box(x, 3.4, z - 2.4, 18, 4, 0.8);
        b.color('#3a3a44').box(x - 7, 0, z, 1, 2.4, 4).box(x + 7, 0, z, 1, 2.4, 4);
      }
      for (const [x, z] of [[-30, -30], [W + 30, -30], [-30, H + 30], [W + 30, H + 30]]) {
        b.color('#3a3a44').box(x, 0, z, 1.4, 20, 1.4);
        b.color('#fff4c8', { emissive: 0.8 }).box(x, 20, z, 3.4, 3, 3.4);
      }
      const fx = CX;
      const fz = -80;
      b.color('#c8c0b4').cylinder(fx, 0, fz, 22, 3, 12, { top: '#d8d0c4' });
      b.color('#5aa8d8', { emissive: 0.15 }).cylinder(fx, 0.2, fz, 19, 3.1, 12);
      b.color('#c8c0b4').cylinder(fx, 0, fz, 3, 12, 8);
      b.color('#bfe6ff', { emissive: 0.5 }).cone(fx, 12, fz, 5, 6, 8);
    },
    border(b, cx, cz) {
      // A trimmed hedge.
      b.color('#3f7a3a').box(cx, 0, cz, BTILE, 11, BTILE, { top: '#4f8e46', bottom: false });
    },
    wall(b, cx, cz, c) {
      if (c === 'T') {
        b.color('#4a8a3e').box(cx, 0, cz, BTILE - 2, 1, BTILE - 2, { bottom: false });
        tree(b, cx, cz, 1.3, '#3a8440');
      } else if (c === '~') {
        b.color('#b8b0a4').box(cx, 0, cz, BTILE, 0.5, BTILE, { bottom: false });
        water(b, cx, cz, '#3f8fd0');
      } else {
        b.color('#3f7a3a').box(cx, 0, cz, BTILE, 12, BTILE, { top: '#4f8e46', bottom: false });
      }
    },
    // Bushes with flowers.
    block(b, cx, cz, k) {
      const leaf = ['#4f9a44', '#5aa84e', '#468c3e'][k % 3];
      const flower = ['#ff6b8a', '#ffd23e', '#f4f4f4', '#c77dff'][k % 4];
      b.color(leaf).sphere(cx - 2, 5, cz, 6.2, 7, 5).sphere(cx + 3, 6, cz + 2, 5.5, 7, 5).sphere(cx + 1, 8.5, cz - 2, 4.6, 7, 5);
      b.color(flower, { emissive: 0.2 }).box(cx - 3, 9.5, cz + 2, 1.6, 1.6, 1.6).box(cx + 4, 10, cz - 1, 1.6, 1.6, 1.6).box(cx, 12.5, cz - 1, 1.6, 1.6, 1.6);
    },
  },

  haven: {
    colors: { sky: ['#6a8fb8', '#d8e4ec'], fog: ['#c8d4dc', 520, 1100], light: { dir: [-0.3, -1, -0.5], color: '#e4e4e0', ambient: '#6a7280' } },
    world(b) {
      const rnd = seeded(9001);
      // The sea all around, a quay under the arena.
      b.color('#2f6a98', { emissive: 0.06 }).box(CX, -4, CZ, W + 900, 2, H + 800);
      b.color('#8a8e96').box(CX, -3, CZ, W + 70, 3, H + 70, { top: '#9a9ea6' });
      ground(b, '#8a8e96', (x, y) => ((x + y) % 2 ? '#a2a6ae' : '#9a9ea6'));
      // Yellow safety line on the quay edge.
      b.color('#e6b422');
      for (const [x, z, w, d] of [[CX, -30, W + 50, 2], [CX, H + 30, W + 50, 2], [-30, CZ, 2, H + 50], [W + 30, CZ, 2, H + 50]]) {
        b.face([[x - w / 2, 0.05, z - d / 2], [x - w / 2, 0.05, z + d / 2], [x + w / 2, 0.05, z + d / 2], [x + w / 2, 0.05, z - d / 2]], [0, 1, 0]);
      }
      // Two cranes and a cargo ship.
      for (const cx of [-60, W + 60]) {
        b.color('#e6b422');
        for (const [dx, dz] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) b.box(cx + dx, 0, CZ + dz - 20, 2, 60, 2);
        b.box(cx, 60, CZ - 20, 22, 4, 22).box(cx, 64, CZ - 20 + (cx < 0 ? 0 : 0), 4, 4, 110);
        b.color('#3a3a44').box(cx, 44, CZ + 30, 1, 20, 1);
      }
      b.color('#b83a2a').box(CX, -3, H + 120, 260, 14, 50, { top: '#3a3a44' });
      b.color('#f4f4f4').box(CX + 90, 11, H + 120, 40, 18, 36, { top: '#d8d8d8' });
      const cols = ['#c8452c', '#2a6fdb', '#3c8a45', '#e6b422'];
      for (let k = 0; k < 6; k++) b.color(cols[k % 4]).box(CX - 100 + k * 30, 11, H + 120, 26, 10, 16);
      around(rnd, 24, (x, z, s, i) => b.color(cols[i % 4]).box(x, 0, z, 30 * s, 12, 12));
    },
    border(b, cx, cz) {
      // A low quay wall with black-and-yellow stripes.
      b.color('#6a6e76').box(cx, 0, cz, BTILE, 7, BTILE, { top: '#e6b422', bottom: false });
      b.color('#1c1c24').box(cx, 7, cz, BTILE - 8, 0.3, BTILE + 0.2, { bottom: false });
    },
    wall(b, cx, cz, c, k) {
      if (c === '~') {
        b.color('#5a5e66').box(cx, -2, cz, BTILE, 2, BTILE, { bottom: false });
        water(b, cx, cz, '#2f78b0');
        return;
      }
      // Shipping containers with ribs.
      const col = ['#c8452c', '#2a6fdb', '#3c8a45', '#e6b422', '#8a4fb8'][k % 5];
      b.color(col).box(cx, 0, cz, BTILE, 14, BTILE, { bottom: false });
      b.color('#1c1c24');
      for (const dx of [-5, 0, 5]) b.box(cx + dx, 0.5, cz + BTILE / 2 + 0.05, 0.6, 13, 0.3, { bottom: false });
    },
    // Wooden crates and barrels.
    block(b, cx, cz, k) {
      if (k % 3 === 0) {
        b.color('#7a5234').cylinder(cx - 3, 0, cz - 2, 3.4, 9, 8, { top: '#6a4428' }).cylinder(cx + 3.5, 0, cz + 3, 3.4, 9, 8, { top: '#6a4428' });
        b.color('#3a3a44').cylinder(cx - 3, 3, cz - 2, 3.6, 0.8, 8).cylinder(cx + 3.5, 3, cz + 3, 3.6, 0.8, 8);
      } else {
        b.color('#b08050').box(cx, 0, cz, 13, 8, 13, { top: '#c09060', bottom: false });
        b.color('#8a6038').box(cx, 7.6, cz, 13.4, 0.8, 13.4, { bottom: false }).box(cx, 0, cz, 13.4, 0.8, 13.4, { bottom: false });
        b.color('#c09060').box(cx + 1, 8, cz - 1, 8, 5, 8, { top: '#d0a070', bottom: false });
      }
    },
  },

  kasteel: {
    colors: { sky: ['#5a88c8', '#e8e0d0'], fog: ['#d8d0c0', 520, 1100], light: { dir: [-0.5, -1, -0.4], color: '#f0e0c0', ambient: '#6e6a66' } },
    world(b) {
      const rnd = seeded(1313);
      ground(b, '#6a9a48', (x, y) => ((x + y) % 2 ? '#b8ae9c' : '#ada392'));
      // A moat around the castle, a drawbridge, banners and fields.
      b.color('#3a6a90', { emissive: 0.06 });
      for (const [x, z, w, d] of [[CX, -34, W + 100, 26], [CX, H + 34, W + 100, 26], [-34, CZ, 26, H + 42], [W + 34, CZ, 26, H + 42]]) {
        b.face([[x - w / 2, 0.02, z - d / 2], [x - w / 2, 0.02, z + d / 2], [x + w / 2, 0.02, z + d / 2], [x + w / 2, 0.02, z - d / 2]], [0, 1, 0]);
      }
      b.color('#7a5234').box(CX, 0, -34, 22, 1.2, 30, { top: '#8a6038' });
      for (const [x, z, col] of [[-50, -50, '#c8452c'], [W + 50, -50, '#2a6fdb'], [-50, H + 50, '#e6b422'], [W + 50, H + 50, '#3c8a45']]) {
        b.color('#6a6a72').box(x, 0, z, 1.2, 40, 1.2);
        b.color(col).box(x + 6, 32, z, 11, 7, 0.4);
      }
      around(rnd, 50, (x, z, s, i) => (i % 3 ? tree(b, x, z, s, '#4a8a3e') : b.color('#d8b44a').box(x, 0, z, 12 * s, 1.4, 16 * s, { bottom: false })));
    },
    border(b, cx, cz, x, y) {
      // Castle wall with battlements.
      b.color('#8a847a').box(cx, 0, cz, BTILE, 14, BTILE, { top: '#9a948a', bottom: false });
      if ((x + y) % 2 === 0) b.color('#9a948a').box(cx, 14, cz, BTILE - 4, 4, BTILE - 4, { bottom: false });
    },
    wall(b, cx, cz, c) {
      if (c === 'T') {
        // A round tower with a pointed roof and a flag.
        b.color('#9a948a').cylinder(cx, 0, cz, 8.5, 24, 10, { top: '#8a847a' });
        b.color('#7a3a4a').cone(cx, 24, cz, 10, 12, 10);
        b.color('#6a6a72').box(cx, 36, cz, 0.6, 7, 0.6);
        b.color('#e6b422').box(cx + 2.5, 40, cz, 5, 3, 0.3);
      } else {
        b.color('#a39c90').box(cx, 0, cz, BTILE, 13, BTILE, { top: '#b0a99c', bottom: false });
        b.color('#8a847a').box(cx, 6, cz, BTILE + 0.3, 0.8, BTILE + 0.3, { bottom: false });
      }
    },
    // Hay bales with rope, sometimes a barrel on top.
    block(b, cx, cz, k) {
      b.color('#d8b44a').box(cx, 0, cz, 13, 8, 13, { top: '#e4c25a', bottom: false });
      b.color('#9a7a3a').box(cx, 0, cz - 3.5, 13.3, 8.2, 0.8, { bottom: false }).box(cx, 0, cz + 3.5, 13.3, 8.2, 0.8, { bottom: false });
      if (k % 2) b.color('#7a5234').cylinder(cx, 8, cz, 3.4, 6, 8, { top: '#6a4428' });
    },
  },

  winter: {
    colors: { sky: ['#7aa6d4', '#e8f0f8'], fog: ['#dde6ee', 480, 1050], light: { dir: [-0.45, -1, -0.45], color: '#e2e8f0', ambient: '#687282' } },
    snow: true,
    world(b) {
      const rnd = seeded(2024);
      ground(b, '#e4ebf2', (x, y) => ((x + y) % 2 ? '#d8e2ec' : '#ccd8e4'));
      around(rnd, 80, (x, z, s, i) => {
        if (i % 9 === 0) {
          // A cabin with a snowy roof and a warm window.
          b.color('#7a4f2e').box(x, 0, z, 22, 11, 16, { bottom: false });
          gable(b, x, 11, z, 24, 18, 8, '#f4f8fc', '#7a4f2e');
          b.color('#ffd27a', { emissive: 0.6 }).box(x, 4, z + 8.1, 4, 4, 0.3, { bottom: false });
        } else pine(b, x, z, s * 1.3, true);
      });
    },
    border(b, cx, cz) {
      // A wall of packed snow with an icy cap.
      b.color('#aebccb').box(cx, 0, cz, BTILE, 10, BTILE, { top: '#f8fbff', bottom: false });
      b.color('#bfe0f4', { emissive: 0.1 }).box(cx, 10, cz, BTILE - 4, 0.8, BTILE - 4, { bottom: false });
    },
    wall(b, cx, cz, c) {
      if (c === 'T') {
        b.color('#b8c8d8').box(cx, 0, cz, BTILE - 2, 1, BTILE - 2, { bottom: false });
        pine(b, cx, cz, 1.25, false);
        b.color('#f8fbff').cone(cx, 18, cz, 3.4, 3.6, 7); // snow on the top
      } else if (c === '~') {
        b.color('#b8c8d8').box(cx, 0, cz, BTILE, 0.5, BTILE, { bottom: false });
        water(b, cx, cz, '#7fc0e8', true);
      } else {
        // An ice pillar.
        b.color('#6fb4e0', { emissive: 0.15 }).box(cx, 0, cz, BTILE - 2, 15, BTILE - 2, { top: '#cfeaff', bottom: false });
      }
    },
    // Snowmen with a hat and a carrot nose.
    block(b, cx, cz, k) {
      b.color('#f8fbff').sphere(cx, 4.5, cz, 5.6, 8, 5).sphere(cx, 11, cz, 4, 8, 5);
      b.color('#ff8a2a').box(cx + 4.4, 11, cz, 2.6, 0.8, 0.8);
      b.color('#1c1c24').box(cx + 3.6, 12.2, cz - 1.2, 0.6, 0.6, 0.6).box(cx + 3.6, 12.2, cz + 1.2, 0.6, 0.6, 0.6);
      b.color(['#c8452c', '#2a6fdb', '#3c8a45'][k % 3]).box(cx, 7.8, cz, 8.4, 1.2, 8.4, { bottom: false });
      b.color('#1c1c24').box(cx, 14.6, cz, 5, 0.6, 5).box(cx, 15.2, cz, 3.4, 3.4, 3.4);
    },
  },
};

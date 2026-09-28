// Boemstad in 3D: a sunny Dutch village on a green. Blocks are brick houses
// with gabled roofs, the fixed walls are stone posts and a brick town wall,
// bombs sizzle at the fuse, flames burn along the lanes.
// World mapping: game (x, y) → 3D (x, 0, y), like Tank Tumult.
import { createRenderer3D } from '../../js/gl/renderer.js';
import { MeshBuilder, rgb } from '../../js/gl/mesh.js';
import { create, compose } from '../../js/gl/mat4.js';
import { createParticles3D } from '../../js/gl/particles.js';
import { BOMB_COLS, BOMB_ROWS, BTILE, BT, BOMB_WORLD, ITEM_COLORS, isFixedWall } from '../../../shared/games/bomber.js';

const CX = BOMB_WORLD.width / 2;
const CZ = BOMB_WORLD.height / 2;
const YAW = [0, -Math.PI / 2, Math.PI, Math.PI / 2]; // dir → yaw (right, down, left, up)

export function createBomberScene(canvas, { reducedMotion }) {
  const r = createRenderer3D(canvas);
  if (!r) return null;
  r.setColors({
    sky: ['#4a93d8', '#d8ecf8'],
    fog: ['#cfe0c8', 520, 1100],
    light: { dir: [-0.4, -1, -0.5], color: '#ece2c8', ambient: '#6a7066' },
    sun: null,
  });
  const floor = r.mesh(buildFloor());
  const walls = r.mesh(new Float32Array(0));
  const houses = r.mesh(new Float32Array(0));
  const bomb = r.mesh(buildBomb());
  const flame = r.mesh(new MeshBuilder().color('#ff8a2a', { emissive: 1 }).box(0, 0, 0, 13, 7, 13).color('#ffe14d', { emissive: 1 }).box(0, 7, 0, 8, 3, 8).build());
  const item = r.mesh(new MeshBuilder().color('#ffffff', { emissive: 0.5, tint: 1 }).octa(0, 0, 0, 4, 5).build());
  const person = r.mesh(buildPerson());
  const shadow = r.mesh(buildShadow());
  const particles = createParticles3D(500, { reducedMotion });
  const m = create();
  let wallKey = '';
  let houseKey = '';
  let time = 0;
  let shake = 0;

  return {
    r,
    particles,

    setTiles(tiles) {
      let wk = '';
      let hk = '';
      for (let i = 0; i < tiles.length; i++) {
        wk += tiles[i] === BT.WALL ? '1' : '0';
        hk += tiles[i] === BT.BLOCK ? '1' : '0';
      }
      if (wk !== wallKey) { wallKey = wk; r.update(walls, buildWalls(tiles)); }
      if (hk !== houseKey) { houseKey = hk; r.update(houses, buildHouses(tiles)); }
    },

    update(dt) {
      time += dt;
      shake = Math.max(0, shake - dt * 14);
      particles.update(dt);
    },

    shake(n) {
      if (!reducedMotion) shake = Math.max(shake, n);
    },

    begin() {
      const sx = shake ? (Math.random() - 0.5) * shake : 0;
      r.camera(CX + sx, 250, CZ + 178, CX, 0, CZ + 8, 0.8, 40, 1200);
      if (!r.begin()) return false;
      compose(m, 0, 0, 0);
      r.draw(floor, m);
      r.draw(walls, m);
      r.draw(houses, m);
      return true;
    },

    bomb(tx, ty, fuse) {
      const pulse = 1 + (reducedMotion ? 0 : Math.sin(time * (8 + (2.4 - fuse) * 8)) * 0.08);
      compose(m, (tx + 0.5) * BTILE, 0, (ty + 0.5) * BTILE, time * 0.5, 0, 0, pulse);
      r.draw(bomb, m, [1, 1, 1], 1, fuse < 0.6 ? Math.abs(Math.sin(time * 30)) * 0.4 : 0);
      if (!reducedMotion && Math.random() < 0.5) {
        particles.spawn((tx + 0.5) * BTILE + 2, 12.5, (ty + 0.5) * BTILE, (Math.random() - 0.5) * 10, 14, (Math.random() - 0.5) * 10, 0.3, '#ffd23e', 1.2, -20, 0.95);
      }
    },

    flame(tx, ty) {
      const flicker = reducedMotion ? 1 : 0.85 + Math.random() * 0.3;
      compose(m, (tx + 0.5) * BTILE, 0.2, (ty + 0.5) * BTILE, 0, 0, 0, flicker);
      r.draw(flame, m);
    },

    item(tx, ty, type) {
      const bob = reducedMotion ? 0 : Math.sin(time * 3 + tx) * 1.5;
      compose(m, (tx + 0.5) * BTILE, 7 + bob, (ty + 0.5) * BTILE, time * 2);
      r.draw(item, m, rgb(ITEM_COLORS[type]));
    },

    person(x, y, dir, color, walking) {
      const bob = walking && !reducedMotion ? Math.abs(Math.sin(time * 14)) * 1.2 : 0;
      compose(m, x, bob, y, YAW[dir] ?? 0, 0, 0, 1);
      r.draw(person, m, color);
    },

    shadow(x, y) {
      compose(m, x, 0.15, y);
      r.draw(shadow, m, [1, 1, 1], 0.4);
    },

    blast(tx, ty) {
      particles.burst((tx + 0.5) * BTILE, 6, (ty + 0.5) * BTILE, '#ffd23e', 24, { speed: 50, life: 0.6, size: 2.5, gravity: -20, up: 0.8 });
      particles.burst((tx + 0.5) * BTILE, 6, (ty + 0.5) * BTILE, '#ff5a2a', 16, { speed: 30, life: 0.8, size: 3, gravity: -5, up: 0.6 });
      this.shake(6);
    },

    endParticles() {
      particles.draw(r);
    },

    project(x, y, h, out) {
      return r.project(x, h, y, out);
    },

    destroy() {
      r.destroy();
    },
  };
}

function buildFloor() {
  const b = new MeshBuilder();
  let seed = 4242;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  b.color('#5f9a45').box(CX, -2, CZ, BOMB_WORLD.width + 600, 2, BOMB_WORLD.height + 500);
  for (let y = 0; y < BOMB_ROWS; y++) {
    for (let x = 0; x < BOMB_COLS; x++) {
      b.color((x + y) % 2 ? '#78b556' : '#70ad4f');
      b.face([[x * BTILE, 0, y * BTILE], [x * BTILE, 0, y * BTILE + BTILE], [x * BTILE + BTILE, 0, y * BTILE + BTILE], [x * BTILE + BTILE, 0, y * BTILE]], [0, 1, 0]);
    }
  }
  // A brick road around the town wall, then trees and tulip fields.
  const W = BOMB_WORLD.width;
  const H = BOMB_WORLD.height;
  b.color('#b8a58a');
  for (const [x, z, w, d] of [[CX, -14, W + 56, 20], [CX, H + 14, W + 56, 20], [-14, CZ, 20, H + 8], [W + 14, CZ, 20, H + 8]]) {
    b.face([[x - w / 2, 0.05, z - d / 2], [x - w / 2, 0.05, z + d / 2], [x + w / 2, 0.05, z + d / 2], [x + w / 2, 0.05, z - d / 2]], [0, 1, 0]);
  }
  const tulips = ['#e63946', '#ffb020', '#f4f4f4', '#d94f9a'];
  for (let i = 0; i < 70; i++) {
    const side = i % 4;
    const along = rnd();
    const out = 40 + rnd() * 110;
    const x = side === 0 ? -out : side === 1 ? W + out : along * (W + 240) - 120;
    const z = side === 2 ? -out : side === 3 ? H + out : along * (H + 200) - 100;
    const s = 0.8 + rnd() * 0.5;
    if (rnd() < 0.6) {
      b.color('#6b4a2e').box(x, 0, z, 2.4 * s, 8 * s, 2.4 * s, { bottom: false });
      b.color(['#3c8a45', '#4a9a4a', '#2f7a3b'][i % 3]).sphere(x, 13 * s, z, 7.5 * s, 6, 4);
    } else {
      b.color(tulips[i % tulips.length]);
      for (let k = 0; k < 4; k++) b.box(x + (k - 1.5) * 5, 0, z, 3, 1.2, 14, { bottom: false });
    }
  }
  return b.build();
}

function buildWalls(tiles) {
  const b = new MeshBuilder();
  for (let y = 0; y < BOMB_ROWS; y++) {
    for (let x = 0; x < BOMB_COLS; x++) {
      if (tiles[y * BOMB_COLS + x] !== BT.WALL) continue;
      const border = x === 0 || y === 0 || x === BOMB_COLS - 1 || y === BOMB_ROWS - 1;
      const dropped = !isFixedWall(x, y);
      const h = border ? 12 : 14;
      const cx = (x + 0.5) * BTILE;
      const cz = (y + 0.5) * BTILE;
      if (border) {
        // Town wall in red brick with a stone coping.
        b.color('#9a4a36').box(cx, 0, cz, BTILE, h, BTILE, { top: '#a8503a', bottom: false });
        b.color('#c8bcaa').box(cx, h, cz, BTILE - 6, 0.6, BTILE - 6, { bottom: false });
        b.color('#7e3a2a').box(cx, h * 0.5, cz, BTILE + 0.3, 0.8, BTILE + 0.3, { bottom: false });
      } else if (dropped) {
        // Sudden death: heavy crates dropped into the streets.
        b.color('#5a4a3a').box(cx, 0, cz, BTILE, h, BTILE, { top: '#6a5846', bottom: false });
        b.color('#e6b422').box(cx, h, cz, BTILE - 5, 0.5, 2, { bottom: false }).box(cx, h, cz, 2, 0.5, BTILE - 5, { bottom: false });
      } else {
        // Stone posts.
        b.color('#8a8a92').box(cx, 0, cz, BTILE, h, BTILE, { top: '#a2a2aa', bottom: false });
        b.color('#74747c').box(cx, h * 0.33, cz, BTILE + 0.3, 0.8, BTILE + 0.3, { bottom: false }).box(cx, h * 0.66, cz, BTILE + 0.3, 0.8, BTILE + 0.3, { bottom: false });
      }
    }
  }
  return b.build();
}

// Destructible blocks: little Dutch houses with a gabled roof and windows.
function buildHouses(tiles) {
  const b = new MeshBuilder();
  const bricks = ['#b5553c', '#a0472f', '#c9784e', '#d8c8a8'];
  const roofs = ['#6a2a22', '#3a3a44', '#8a3a2a'];
  for (let y = 0; y < BOMB_ROWS; y++) {
    for (let x = 0; x < BOMB_COLS; x++) {
      if (tiles[y * BOMB_COLS + x] !== BT.BLOCK) continue;
      const cx = (x + 0.5) * BTILE;
      const cz = (y + 0.5) * BTILE;
      const k = x * 7 + y * 3;
      b.color(bricks[k % bricks.length]).box(cx, 0, cz, 13, 8, 13, { bottom: false });
      gable(b, cx, 8, cz, 14, 14, 6, roofs[k % roofs.length], bricks[k % bricks.length]);
      // White window frames with blue glass, a door
      b.color('#f4f4f4').box(cx - 3, 3.6, cz + 6.55, 3.2, 3.2, 0.3, { bottom: false }).box(cx + 3, 3.6, cz + 6.55, 3.2, 3.2, 0.3, { bottom: false });
      b.color('#7fb0d8').box(cx - 3, 4, cz + 6.75, 2.2, 2.4, 0.2, { bottom: false }).box(cx + 3, 4, cz + 6.75, 2.2, 2.4, 0.2, { bottom: false });
      b.color('#2f5a3a').box(cx + 6.55, 0, cz, 0.3, 5.5, 3, { bottom: false });
    }
  }
  return b.build();
}

// Gabled roof with its ridge along x: two slopes and two triangular ends.
function gable(b, x, y, z, w, d, h, roof, wall) {
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
  b.color(roof);
  b.face([[x0, y, z1], [x1, y, z1], [x1, y + h, z], [x0, y + h, z]], [0, 1, 1]);
  b.face([[x0, y, z0], [x0, y + h, z], [x1, y + h, z], [x1, y, z0]], [0, 1, -1]);
  b.color(wall);
  b.face([[x1 - 0.5, y, z0 + 0.5], [x1 - 0.5, y + h - 0.4, z], [x1 - 0.5, y, z1 - 0.5]], [1, 0, 0]);
  b.face([[x0 + 0.5, y, z0 + 0.5], [x0 + 0.5, y, z1 - 0.5], [x0 + 0.5, y + h - 0.4, z]], [-1, 0, 0]);
}

function buildBomb() {
  const b = new MeshBuilder();
  b.color('#1a1a28').sphere(0, 5.2, 0, 5.2, 10, 6);
  b.color('#8a8fb8').box(0, 9.6, 0, 2, 1.4, 2);
  b.color('#ffd23e', { emissive: 1 }).octa(0, 12, 0, 1.3, 1.6);
  return b.build();
}

// A small bomber person facing +x; tint = the player's colour.
function buildPerson() {
  const b = new MeshBuilder();
  b.color('#1c1c28').box(1, 0, 2.2, 3.5, 1.6, 2.2).box(1, 0, -2.2, 3.5, 1.6, 2.2);
  b.color('#ffffff', { tint: 1 }).box(0, 1.6, 0, 6.5, 6, 7, { top: '#ffffff' });
  b.color('#f4f4ff').sphere(0, 11, 0, 4.2, 8, 5);
  b.color('#10101a').box(3.4, 10.4, 0, 1.2, 2.2, 4.6);
  b.color('#f4f4ff').box(4.05, 10.8, -1, 0.3, 0.9, 0.9).box(4.05, 10.8, 1, 0.3, 0.9, 0.9);
  b.color('#8a8fb8').box(0, 15, 0, 0.6, 2.4, 0.6);
  b.color('#ffffff', { emissive: 0.3, tint: 1 }).octa(0, 18, 0, 1.4, 1.4);
  return b.build();
}

function buildShadow() {
  const pts = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    return [Math.cos(a) * 7, 0, Math.sin(a) * 7];
  });
  return new MeshBuilder().color('#000000').face(pts, [0, 1, 0]).build();
}

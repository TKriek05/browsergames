// Boemstad in 3D: a little neon city. Blocks are houses with lit windows,
// bombs glow at the fuse, flames burn along the streets.
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
    sky: ['#0b0620', '#2a1050'],
    fog: ['#120a2a', 380, 800],
    light: { dir: [-0.4, -1, -0.5], color: '#e8e4ff', ambient: '#4c4674' },
    sun: null,
  });
  const floor = r.mesh(buildFloor());
  const walls = r.mesh(new Float32Array(0));
  const houses = r.mesh(new Float32Array(0));
  const bomb = r.mesh(buildBomb());
  const flame = r.mesh(new MeshBuilder().color('#ff8a2a', { emissive: 1 }).box(0, 0, 0, 13, 7, 13).color('#ffe14d', { emissive: 1 }).box(0, 7, 0, 8, 3, 8).build());
  const item = r.mesh(new MeshBuilder().color('#ffffff', { emissive: 0.9, tint: 1 }).octa(0, 0, 0, 4, 5).build());
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
  b.color('#0d0a24').box(CX, -2, CZ, BOMB_WORLD.width + 300, 2, BOMB_WORLD.height + 300);
  for (let y = 0; y < BOMB_ROWS; y++) {
    for (let x = 0; x < BOMB_COLS; x++) {
      b.color((x + y) % 2 ? '#1d1b3a' : '#222046');
      b.face([[x * BTILE, 0, y * BTILE], [x * BTILE, 0, y * BTILE + BTILE], [x * BTILE + BTILE, 0, y * BTILE + BTILE], [x * BTILE + BTILE, 0, y * BTILE]], [0, 1, 0]);
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
      const h = border ? 14 : 16;
      const cx = (x + 0.5) * BTILE;
      const cz = (y + 0.5) * BTILE;
      b.color(dropped ? '#4a2440' : border ? '#241f55' : '#2c2766').box(cx, 0, cz, BTILE, h, BTILE, { top: '#3a3486', bottom: false });
      b.color(dropped ? '#ff4d6d' : border ? '#ff3ea5' : '#3ef0ff', { emissive: 1 }).box(cx, h, cz, BTILE - 4, 0.6, BTILE - 4, { bottom: false });
    }
  }
  return b.build();
}

// Destructible blocks: little houses with a roof and lit windows.
function buildHouses(tiles) {
  const b = new MeshBuilder();
  const roofs = ['#b8742a', '#8a4fb8', '#2f8a8a', '#b84f6a'];
  for (let y = 0; y < BOMB_ROWS; y++) {
    for (let x = 0; x < BOMB_COLS; x++) {
      if (tiles[y * BOMB_COLS + x] !== BT.BLOCK) continue;
      const cx = (x + 0.5) * BTILE;
      const cz = (y + 0.5) * BTILE;
      b.color('#d8c8a8').box(cx, 0, cz, 13, 10, 13, { top: roofs[(x * 7 + y * 3) % roofs.length], bottom: false });
      b.color('#ffd76a', { emissive: 1 });
      b.box(cx - 3, 4, cz + 6.6, 2.4, 2.6, 0.3, { bottom: false }).box(cx + 3, 4, cz + 6.6, 2.4, 2.6, 0.3, { bottom: false });
      b.box(cx + 6.6, 4, cz, 0.3, 2.6, 2.4, { bottom: false });
      b.color('#5a3a2a').box(cx, 10, cz, 9, 2.5, 9, { bottom: false });
    }
  }
  return b.build();
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
  b.color('#3ef0ff', { emissive: 1 }).box(4.05, 10.8, 0, 0.3, 0.8, 3.4);
  b.color('#8a8fb8').box(0, 15, 0, 0.6, 2.4, 0.6);
  b.color('#ffffff', { emissive: 0.8, tint: 1 }).octa(0, 18, 0, 1.4, 1.4);
  return b.build();
}

function buildShadow() {
  const pts = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    return [Math.cos(a) * 7, 0, Math.sin(a) * 7];
  });
  return new MeshBuilder().color('#000000').face(pts, [0, 1, 0]).build();
}

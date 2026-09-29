// Boemstad in 3D: each map has its own world (themes.js): a Dutch village,
// a city park, a harbour, a castle or a snowy village. Bombs sizzle at the
// fuse, flames burn along the lanes.
// World mapping: game (x, y) → 3D (x, 0, y), like Tank Tumult.
import { createRenderer3D } from '../../js/gl/renderer.js';
import { MeshBuilder, rgb } from '../../js/gl/mesh.js';
import { create, compose } from '../../js/gl/mat4.js';
import { createParticles3D } from '../../js/gl/particles.js';
import { BOMB_COLS, BOMB_ROWS, BTILE, BT, BOMB_WORLD, ITEM_COLORS, isFixedWall, mapTile } from '../../../shared/games/bomber.js';
import { THEMES } from './themes.js';

const CX = BOMB_WORLD.width / 2;
const CZ = BOMB_WORLD.height / 2;
const YAW = [0, -Math.PI / 2, Math.PI, Math.PI / 2]; // dir → yaw (right, down, left, up)

export function createBomberScene(canvas, { reducedMotion }) {
  const r = createRenderer3D(canvas);
  if (!r) return null;
  const floor = r.mesh(new Float32Array(0));
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
  let mapId = '';
  let theme = THEMES.stad;

  return {
    r,
    particles,

    // A new map (between rounds): its colours, its world, its walls.
    setMap(id) {
      if (id === mapId) return;
      mapId = id;
      theme = THEMES[id] ?? THEMES.stad;
      r.setColors({ ...theme.colors, sun: null });
      r.update(floor, buildWorld(theme));
      wallKey = '';
      houseKey = '';
    },

    setTiles(tiles) {
      let wk = '';
      let hk = '';
      for (let i = 0; i < tiles.length; i++) {
        wk += tiles[i] === BT.WALL ? '1' : '0';
        hk += tiles[i] === BT.BLOCK ? '1' : '0';
      }
      if (wk !== wallKey) { wallKey = wk; r.update(walls, buildWalls(tiles, theme, mapId)); }
      if (hk !== houseKey) { houseKey = hk; r.update(houses, buildBlocks(tiles, theme)); }
    },

    update(dt) {
      time += dt;
      shake = Math.max(0, shake - dt * 14);
      particles.update(dt);
      // Snowfall in the winter village.
      if (theme.snow && !reducedMotion && Math.random() < 0.8) {
        particles.spawn(Math.random() * (BOMB_WORLD.width + 200) - 100, 90, Math.random() * (BOMB_WORLD.height + 160) - 80, (Math.random() - 0.5) * 6, -14, (Math.random() - 0.5) * 6, 6, '#ffffff', 1.4, 0, 1);
      }
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
      if (r.shadows) return; // the sun casts a real one
      compose(m, x, 0.15, y);
      r.draw(shadow, m, [1, 1, 1], 0.4);
    },

    blast(tx, ty) {
      particles.burst((tx + 0.5) * BTILE, 6, (ty + 0.5) * BTILE, '#ffd23e', 24, { speed: 50, life: 0.6, size: 2.5, gravity: -20, up: 0.8 });
      particles.burst((tx + 0.5) * BTILE, 6, (ty + 0.5) * BTILE, '#ff5a2a', 16, { speed: 30, life: 0.8, size: 3, gravity: -5, up: 0.6 });
      this.shake(6);
    },

    endParticles() {
      particles.draw(r, 1, true);
    },

    project(x, y, h, out) {
      return r.project(x, h, y, out);
    },

    destroy() {
      r.destroy();
    },
  };
}

function buildWorld(theme) {
  const b = new MeshBuilder();
  theme.world(b);
  return b.build();
}

function buildWalls(tiles, theme, mapId) {
  const b = new MeshBuilder();
  for (let y = 0; y < BOMB_ROWS; y++) {
    for (let x = 0; x < BOMB_COLS; x++) {
      if (tiles[y * BOMB_COLS + x] !== BT.WALL) continue;
      const cx = (x + 0.5) * BTILE;
      const cz = (y + 0.5) * BTILE;
      const border = x === 0 || y === 0 || x === BOMB_COLS - 1 || y === BOMB_ROWS - 1;
      if (border) theme.border(b, cx, cz, x, y);
      else if (!isFixedWall(x, y, mapId)) {
        // Sudden death: heavy crates dropped into the streets.
        b.color('#5a4a3a').box(cx, 0, cz, BTILE, 14, BTILE, { top: '#6a5846', bottom: false });
        b.color('#e6b422').box(cx, 14, cz, BTILE - 5, 0.5, 2, { bottom: false }).box(cx, 14, cz, 2, 0.5, BTILE - 5, { bottom: false });
      } else theme.wall(b, cx, cz, mapTile(mapId, x, y), x * 7 + y * 3);
    }
  }
  return b.build();
}

// Destructible blocks in the theme's style.
function buildBlocks(tiles, theme) {
  const b = new MeshBuilder();
  for (let y = 0; y < BOMB_ROWS; y++) {
    for (let x = 0; x < BOMB_COLS; x++) {
      if (tiles[y * BOMB_COLS + x] !== BT.BLOCK) continue;
      theme.block(b, (x + 0.5) * BTILE, (y + 0.5) * BTILE, x * 7 + y * 3);
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

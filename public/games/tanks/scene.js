// Tank Tumult in 3D: the arena in its theme (desert camp, forest or winter
// fort: floor, walls, wooden crates, scenery around it), low-poly tanks with
// a separate turret, bullets, spinning power-ups and particles.
// World mapping: game (x, y) → 3D (x, 0, y); the camera looks from the south.
import { createRenderer3D } from '../../js/gl/renderer.js';
import { MeshBuilder, rgb } from '../../js/gl/mesh.js';
import { create, compose, yawFromDir } from '../../js/gl/mat4.js';
import { createParticles3D } from '../../js/gl/particles.js';
import { TANK_TILE, TANK_COLS, TANK_ROWS, TANK_WORLD, TILE } from '../../../shared/maps/tank-arenas.js';
import { POWERUPS } from '../../../shared/games/tanks.js';
import { tankTheme } from './theme.js';

const WALL_H = 16;
const MODEL_SCALE = 1.15; // tanks look a bit bigger than their hitbox
const CRATE = 13;
const CX = TANK_WORLD.width / 2;
const CZ = TANK_WORLD.height / 2;

export function createTankScene(canvas, { arena, reducedMotion }) {
  const r = createRenderer3D(canvas);
  if (!r) return null;
  const th = tankTheme(arena.key);
  r.setColors({
    sky: th.sky,
    fog: [th.fog, 600, 1300],
    light: { dir: [-0.35, -1, -0.55], color: th.light.color, ambient: th.light.ambient },
    sun: null,
  });

  const floor = r.mesh(buildFloor(arena, th));
  const walls = r.mesh(buildWalls(arena, th));
  const crates = r.mesh(new Float32Array(0));
  const hull = r.mesh(buildHull());
  const turret = r.mesh(buildTurret());
  const wreck = r.mesh(buildWreck());
  const bullet = r.mesh(new MeshBuilder().color('#ffffff', { emissive: 0.8, tint: 0.6 }).octa(0, 0, 0, 2.2, 2.2).build());
  const pickup = r.mesh(buildPickup());
  const shadow = r.mesh(buildShadow());
  const shield = r.mesh(new MeshBuilder().color('#ffffff', { emissive: 0.7, tint: 1 }).sphere(0, 0, 0, 11, 8, 5).build());
  const particles = createParticles3D(500, { reducedMotion });
  const m = create();
  let crateKey = '';
  let shake = 0;
  let time = 0;
  // Camera focus (smoothed): follows your tank, or shows the whole arena.
  const focus = { x: CX, y: CZ, zoom: 1, ready: false };

  return {
    r,
    particles,

    // Rebuild the crate mesh when their hit points change.
    setCrates(hp) {
      const key = hp.join('');
      if (key === crateKey) return;
      crateKey = key;
      r.update(crates, buildCrates(arena, hp));
    },

    shake(amount) {
      if (!reducedMotion) shake = Math.max(shake, amount);
    },

    update(dt) {
      time += dt;
      shake = Math.max(0, shake - dt * 12);
      particles.update(dt);
    },

    // follow: { x, y } of your tank, or null for the overview.
    begin(follow, dt) {
      // Stay over the arena near its edges instead of showing the void around it.
      const tx = follow ? clamp(follow.x * 0.85 + CX * 0.15, CX - 120, CX + 120) : CX;
      const ty = follow ? clamp(follow.y * 0.85 + CZ * 0.15, CZ - 75, CZ + 45) : CZ;
      const tz = follow ? 0.62 : 1;
      const k = focus.ready ? Math.min(1, dt * 4) : 1;
      focus.x += (tx - focus.x) * k;
      focus.y += (ty - focus.y) * k;
      focus.zoom += (tz - focus.zoom) * k;
      focus.ready = true;
      const sx = shake ? (Math.random() - 0.5) * shake : 0;
      const sz = shake ? (Math.random() - 0.5) * shake : 0;
      const z = focus.zoom;
      r.camera(focus.x + sx, 400 * z, focus.y + 12 + 270 * z + sz, focus.x, 0, focus.y + 12, 0.78, 40, 1400);
      if (!r.begin()) return false;
      compose(m, 0, 0, 0);
      r.draw(floor, m);
      r.draw(walls, m);
      r.draw(crates, m);
      return true;
    },

    tank(x, y, dx, dy, aim, color, { recoil = 0, flash = 0 } = {}) {
      const yaw = yawFromDir(dx, dy);
      compose(m, x, 0, y, yaw, 0, 0, MODEL_SCALE);
      r.draw(hull, m, color, 1, flash);
      const back = recoil * 1.8;
      compose(m, x - Math.cos(aim) * back, 0, y - Math.sin(aim) * back, yawFromDir(Math.cos(aim), Math.sin(aim)), 0, 0, MODEL_SCALE);
      r.draw(turret, m, color, 1, flash);
    },

    wreck(x, y, dx, dy) {
      compose(m, x, 0, y, yawFromDir(dx, dy), 0, 0.08, MODEL_SCALE);
      r.draw(wreck, m);
      if (!reducedMotion && Math.random() < 0.25) {
        particles.spawn(x + (Math.random() - 0.5) * 6, 6, y + (Math.random() - 0.5) * 6, 0, 12 + Math.random() * 8, 0, 1.2, '#5a5652', 3, 0, 0.99);
      }
    },

    bullet(x, y, color) {
      compose(m, x, 5.5, y, time * 8);
      r.draw(bullet, m, color);
      if (!reducedMotion && Math.random() < 0.6) particles.spawn(x, 5.5, y, 0, 2, 0, 0.3, '#d8d4cc', 1.4, 0, 1);
    },

    pickup(x, y, type) {
      const bob = reducedMotion ? 0 : Math.sin(time * 3 + x) * 1.5;
      compose(m, x, 5 + bob, y, time * 1.8);
      r.draw(pickup, m, rgb(POWERUPS[type].color));
    },

    // Transparent things last: shadows under tanks and shield bubbles.
    shadow(x, y) {
      compose(m, x, 0.15, y);
      r.draw(shadow, m, [1, 1, 1], 0.45);
    },

    shield(x, y, color) {
      compose(m, x, 5, y, time);
      r.draw(shield, m, color, 0.28 + (reducedMotion ? 0 : Math.sin(time * 8) * 0.06));
    },

    explosion(x, y, color) {
      particles.burst(x, 6, y, '#ffd23e', 40, { speed: 60, life: 0.7, size: 3, gravity: -30, up: 0.7 });
      particles.burst(x, 6, y, '#ff6a2a', 30, { speed: 40, life: 0.9, size: 4, gravity: -10, up: 0.5 });
      particles.burst(x, 6, y, color, 16, { speed: 70, life: 0.6, size: 2, gravity: -60, up: 0.8 });
      this.shake(10);
    },

    sparks(x, y, color = '#ffe14d', n = 8) {
      particles.burst(x, 5.5, y, color, n, { speed: 35, life: 0.3, size: 1.6, gravity: -40, up: 0.6 });
    },

    endParticles() {
      particles.draw(r, 1.2);
    },

    project(x, y, h, out) {
      return r.project(x, h, y, out);
    },

    ground(px, py, out) {
      const p = r.groundPoint(px, py, 5.5, out);
      if (!p) return null;
      out.y = p.z;
      return out;
    },

    destroy() {
      r.destroy();
    },
  };
}

// --- Static meshes ---------------------------------------------------------------
function seeded(seed) {
  let v = seed;
  return () => ((v = (v * 16807) % 2147483647) / 2147483647);
}

function buildFloor(arena, th) {
  const b = new MeshBuilder();
  const T = TANK_TILE;
  const rnd = seeded(arena.key.length * 97 + 11);
  // Ground around the arena, then the arena floor in two soft tones.
  b.color(th.outside).box(CX, -2, CZ, TANK_WORLD.width + 700, 2, TANK_WORLD.height + 600);
  for (let ty = 0; ty < TANK_ROWS; ty++) {
    for (let tx = 0; tx < TANK_COLS; tx++) {
      if (arena.tiles[ty * TANK_COLS + tx] === TILE.WALL) continue;
      b.color((tx * 7 + ty * 3) % 5 === 0 ? th.floor[1] : th.floor[0]);
      b.face([[tx * T, 0, ty * T], [tx * T, 0, ty * T + T], [tx * T + T, 0, ty * T + T], [tx * T + T, 0, ty * T]], [0, 1, 0]);
    }
  }
  // Tyre tracks and small details on the ground.
  b.color(th.track);
  for (let i = 0; i < 90; i++) {
    const x = 20 + rnd() * (TANK_WORLD.width - 40);
    const z = 20 + rnd() * (TANK_WORLD.height - 40);
    const w = 2 + rnd() * 3;
    b.face([[x, 0.05, z], [x, 0.05, z + w * 0.6], [x + w, 0.05, z + w * 0.6], [x + w, 0.05, z]], [0, 1, 0]);
  }
  // Power-up pads: painted landing circles.
  for (const p of arena.pickups) {
    b.color('#f4d23e').cylinder(p.x, 0, p.y, 7, 0.1, 10);
    b.color('#3a3a3a').cylinder(p.x, 0, p.y, 5.2, 0.14, 10);
  }
  scenery(b, th, rnd);
  return b.build();
}

// Cacti and rocks, trees or snowy pines around the arena.
function scenery(b, th, rnd) {
  const W = TANK_WORLD.width;
  const H = TANK_WORLD.height;
  for (let i = 0; i < 110; i++) {
    const side = i % 4;
    const along = rnd();
    const out = 18 + rnd() * 150;
    const x = side === 0 ? -out : side === 1 ? W + out : along * (W + 200) - 100;
    const z = side === 2 ? -out : side === 3 ? H + out : along * (H + 160) - 80;
    const s = 0.7 + rnd() * 0.7;
    const c = th.decoColors[Math.floor(rnd() * th.decoColors.length)];
    if (th.deco === 'desert') {
      if (rnd() < 0.5) {
        b.color(c).box(x, 0, z, 3.6 * s, 16 * s, 3.6 * s, { bottom: false });
        b.box(x + 4 * s, 6 * s, z, 4.4 * s, 2.4 * s, 2.6 * s, { bottom: false }).box(x + 5.6 * s, 6 * s, z, 2.4 * s, 7 * s, 2.4 * s, { bottom: false });
      } else b.color('#a08a6a').octa(x, 0, z, 6 * s, 4 * s);
    } else {
      b.color('#6b4a2e').box(x, 0, z, 2.6 * s, 5 * s, 2.6 * s, { bottom: false });
      b.color(c).cone(x, 4 * s, z, 10 * s, 15 * s, 6).cone(x, 12 * s, z, 7 * s, 12 * s, 6);
      if (th.deco === 'snow') b.color('#f8fbff').cone(x, 19 * s, z, 3.6 * s, 5.5 * s, 6);
    }
  }
}

function buildWalls(arena, th) {
  const b = new MeshBuilder();
  const T = TANK_TILE;
  for (let ty = 0; ty < TANK_ROWS; ty++) {
    for (let tx = 0; tx < TANK_COLS; tx++) {
      if (arena.tiles[ty * TANK_COLS + tx] !== TILE.WALL) continue;
      const edge = tx === 0 || ty === 0 || tx === TANK_COLS - 1 || ty === TANK_ROWS - 1;
      const h = edge ? WALL_H * 0.8 : WALL_H;
      const x = tx * T + T / 2;
      const z = ty * T + T / 2;
      b.color(edge ? th.border : th.wall).box(x, 0, z, T, h, T, { top: edge ? th.borderTop : th.wallTop, bottom: false });
      // Courses of sandbags / stones: slightly wider bands.
      b.color(th.wallLine);
      for (let k = 1; k < 3; k++) b.box(x, (h * k) / 3 - 0.5, z, T + 0.4, 1, T + 0.4, { bottom: false });
      if (th.cap) b.color(th.cap).box(x, h, z, T - 5, 0.8, T - 5, { bottom: false }); // moss or snow on top
    }
  }
  return b.build();
}

function buildCrates(arena, hp) {
  const b = new MeshBuilder();
  arena.crates.forEach((idx, i) => {
    if (!hp[i]) return;
    const x = (idx % TANK_COLS + 0.5) * TANK_TILE;
    const z = (Math.floor(idx / TANK_COLS) + 0.5) * TANK_TILE;
    const hurt = hp[i] < 2;
    const s = hurt ? CRATE - 2 : CRATE;
    b.color(hurt ? '#7a4a22' : '#b8742a').box(x, 0, z, s, s, s, { top: hurt ? '#8f5a2a' : '#d8944a', bottom: false });
    b.color(hurt ? '#4a2c14' : '#7a4a1a').box(x, s, z, s * 0.8, 0.3, 1.6, { bottom: false }).box(x, s, z, 1.6, 0.3, s * 0.8, { bottom: false });
  });
  return b.build();
}

// Hull: faces +x. Tint = the player's colour.
function buildHull() {
  const b = new MeshBuilder();
  b.color('#1c1c28').box(0, 0, 4.4, 14.5, 3.6, 3.2).box(0, 0, -4.4, 14.5, 3.6, 3.2);
  b.color('#3a3a4a');
  for (let i = -3; i <= 3; i++) {
    b.box(i * 2, 3.6, 4.4, 0.8, 0.3, 3.3, { bottom: false }).box(i * 2, 3.6, -4.4, 0.8, 0.3, 3.3, { bottom: false });
  }
  b.color('#ffffff', { tint: 1 }).box(-0.8, 1.4, 0, 11, 3.6, 8, { top: '#ffffff' });
  b.color('#d0d0d0', { tint: 1 }).wedge(5.8, 1.4, 0, 3, 3.6, 8, 1.8);
  b.color('#2c2c34').box(-6.4, 2.2, 0, 0.5, 1.6, 8.2);
  b.color('#e8e0c8').box(3.2, 5, 2.4, 1.6, 0.3, 1.6).box(-4.2, 5, -2.4, 2.4, 0.3, 1.2);
  return b.build();
}

function buildTurret() {
  const b = new MeshBuilder();
  b.color('#e8e8e8', { tint: 1 }).cylinder(-0.5, 5, 0, 3.8, 3, 8, { top: '#ffffff' });
  b.color('#2c2c3a').box(5, 5.8, 0, 9, 1.7, 1.7);
  b.color('#1c1c24').box(9.6, 5.8, 0, 0.8, 2.1, 2.1);
  return b.build();
}

function buildWreck() {
  const b = new MeshBuilder();
  b.color('#1a1418').box(0, 0, 4.4, 14, 3, 3).box(0, 0, -4.4, 14, 3, 3);
  b.color('#2a2226').box(-0.8, 1.2, 0, 11, 3, 8, { top: '#1e181c' });
  b.color('#ff6a2a', { emissive: 0.6 }).box(1, 4.2, 1, 2, 0.4, 2).box(-3, 4.2, -2, 1.5, 0.4, 1.5);
  return b.build();
}

function buildPickup() {
  return new MeshBuilder().color('#ffffff', { emissive: 0.45, tint: 0.85 }).octa(0, 0, 0, 4.2, 6).build();
}

function buildShadow() {
  const b = new MeshBuilder();
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    pts.push([Math.cos(a) * 10, 0, Math.sin(a) * 9]);
  }
  b.color('#000000').face(pts, [0, 1, 0]);
  return b.build();
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

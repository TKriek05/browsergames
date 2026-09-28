// Minigolf in 3D: a mini-golf course in a sunny park. The green is built
// from cells (mown stripes), sand and water are flat patches on top, the
// walls are wooden rails, bumpers are red-and-white posts that flash when hit.
// World mapping: game (x, y) → 3D (x, 0, y), like Tank Tumult.
import { createRenderer3D } from '../../js/gl/renderer.js';
import { MeshBuilder } from '../../js/gl/mesh.js';
import { create, compose } from '../../js/gl/mat4.js';
import { createParticles3D } from '../../js/gl/particles.js';
import { HOLES, BALL_R, CUP_R, inPolygon, inRect, onCourse } from '../../../shared/games/minigolf.js';

const CELL = 5;
const WALL_T = 4;
const WALL_H = 5;
const BASE_Y = -4; // the course is a raised platform
const RAILS = [['#9a6234', '#b87a44'], ['#8a5530', '#a86e3c'], ['#7e4f2c', '#9c683a']]; // wood: side, top
const FLAG_H = 24;

export function createGolfScene(canvas, { reducedMotion }) {
  const r = createRenderer3D(canvas);
  if (!r) return null;
  r.setColors({
    sky: ['#3d8ee0', '#cfe8fb'],
    fog: ['#d5e8f0', 600, 1300],
    light: { dir: [-0.35, -1, -0.5], color: '#ece2c8', ambient: '#6c7468' },
    sun: { dir: [0.4, 0.25, -1], radius: 0.06, top: '#fffbe6', bottom: '#fff1b0' },
    clouds: { count: 10, color: '#ffffff', shade: '#d5e8f0', seed: 3 },
  });
  const ground = r.mesh(buildGround());
  const course = r.mesh(new Float32Array(0));
  const ballR = BALL_R * 1.2; // a bit bigger than the physics ball, easier to see
  const ball = r.mesh(new MeshBuilder().color('#ffffff', { tint: 1, emissive: 0.15 }).sphere(0, ballR, 0, ballR, 10, 6).build());
  const shadow = r.mesh(buildDisc(BALL_R * 1.1, '#000000', 10));
  const flag = [[0, FLAG_H, 0], [0, FLAG_H - 9, 0], [14, FLAG_H - 4.5, 0]];
  const cloth = r.mesh(new MeshBuilder().color('#e63946', { emissive: 0.2 }).face(flag, [0, 0, 1]).face(flag, [0, 0, -1]).build());
  const particles = createParticles3D(400, { reducedMotion });
  const m = create();
  const cam = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };
  let bumpers = []; // { mesh, x, y, r, flash }
  let hole = null;
  let holeIndex = -1;
  let time = 0;
  let shake = 0;

  return {
    setHole(index) {
      if (index === holeIndex) return;
      holeIndex = index;
      hole = HOLES[index];
      r.update(course, buildCourse(hole, RAILS[index % RAILS.length]));
      for (const b of bumpers) r.free(b.mesh);
      bumpers = hole.bumpers.map((b) => ({ mesh: r.mesh(buildBumper(b.r)), x: b.x, y: b.y, r: b.r, flash: 0 }));
      fitCamera(hole, cam);
    },

    update(dt) {
      time += dt;
      shake = Math.max(0, shake - dt * 12);
      for (const b of bumpers) b.flash = Math.max(0, b.flash - dt * 4);
      particles.update(dt);
    },

    begin() {
      if (!hole) return false;
      const sx = shake ? (Math.random() - 0.5) * shake : 0;
      r.camera(cam.x + sx, cam.y, cam.z, cam.tx, 0, cam.tz, 0.8, 30, 1400);
      if (!r.begin()) return false;
      compose(m, 0, 0, 0);
      r.draw(ground, m);
      r.draw(course, m);
      for (const b of bumpers) {
        compose(m, b.x, 0, b.y);
        r.draw(b.mesh, m, [1, 1, 1], 1, b.flash);
      }
      const wave = reducedMotion ? 0 : Math.sin(time * 2.2) * 0.25;
      compose(m, hole.cup[0], 0, hole.cup[1], -0.35 + wave);
      r.draw(cloth, m);
      return true;
    },

    // A ball in the player's colour (rgb 0..1) with its shadow.
    ball(x, y, color, sunk) {
      if (sunk) return;
      compose(m, x, 0.3, y);
      r.draw(shadow, m, [1, 1, 1], 0.35);
      compose(m, x, 0, y);
      r.draw(ball, m, color);
    },

    bumper(x, y) {
      let best = null;
      let bestD = Infinity;
      for (const b of bumpers) {
        const d = Math.hypot(b.x - x, b.y - y) - b.r;
        if (d < bestD) { bestD = d; best = b; }
      }
      if (best && bestD < 6) {
        best.flash = 0.8;
        particles.burst(x, 3, y, '#ffffff', 8, { speed: 30, life: 0.35, size: 1.4, gravity: -30, up: 0.6 });
      }
    },

    splash(x, y) {
      particles.burst(x, 1, y, '#6cc4ff', 22, { speed: 28, life: 0.7, size: 1.8, gravity: -70, up: 1.2 });
      particles.burst(x, 1, y, '#ffffff', 8, { speed: 18, life: 0.5, size: 1.2, gravity: -60, up: 1.4 });
    },

    sink(color) {
      if (!hole) return;
      const [x, y] = hole.cup;
      particles.burst(x, 3, y, color, 30, { speed: 45, life: 1, size: 1.8, gravity: -50, up: 1.4 });
      particles.burst(x, 3, y, '#ffe14d', 14, { speed: 35, life: 0.9, size: 1.4, gravity: -50, up: 1.4 });
      if (!reducedMotion) shake = 2;
    },

    endParticles() {
      particles.draw(r);
    },

    project(x, y, h, out) {
      return r.project(x, h, y, out);
    },

    // Screen pixel (canvas units) → game coordinates on the green, or null.
    ground(px, py, out) {
      const p = r.groundPoint(px, py, 0, out);
      if (!p) return null;
      out.y = p.z;
      return out;
    },

    destroy() {
      r.destroy();
    },
  };
}

// Frame the whole hole: camera south of it, looking down at about 55°.
function fitCamera(hole, cam) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of hole.outline) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const dist = Math.max((x1 - x0 + 36) / 1.42, (y1 - y0 + 24) / 1.0);
  cam.tx = (x0 + x1) / 2;
  cam.tz = (y0 + y1) / 2 + 4;
  cam.x = cam.tx;
  cam.y = dist * 0.82;
  cam.z = cam.tz + dist * 0.6;
}

// Park lawn with trees and flower beds around (never between camera and course).
function buildGround() {
  const b = new MeshBuilder();
  let seed = 99;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  b.color('#4a8a3a').box(140, BASE_Y - 2, 80, 1400, 1, 1000);
  const flowers = ['#e63946', '#ffb020', '#f4f4f4', '#d94f9a'];
  for (let i = 0; i < 60; i++) {
    const zone = i % 3; // 0: behind the course, 1: left, 2: right
    const x = zone === 0 ? -80 + rnd() * 440 : zone === 1 ? -30 - rnd() * 120 : 300 + rnd() * 120;
    const z = zone === 0 ? -20 - rnd() * 160 : -40 + rnd() * 200;
    const s = 0.8 + rnd() * 0.6;
    if (rnd() < 0.7) {
      b.color('#6b4a2e').box(x, BASE_Y - 1, z, 3 * s, 12 * s, 3 * s, { bottom: false });
      b.color(['#3c8a45', '#4a9a4a', '#2f7a3b'][i % 3]).sphere(x, BASE_Y - 1 + 19 * s, z, 10 * s, 6, 4);
    } else {
      b.color('#6a4a32').box(x, BASE_Y - 1, z, 22, 2, 10, { bottom: false });
      b.color(flowers[i % flowers.length]);
      for (let k = 0; k < 5; k++) b.box(x - 8 + k * 4, BASE_Y + 1, z + (k % 2 ? 2 : -2), 2.4, 1.4, 2.4, { bottom: false });
    }
  }
  return b.build();
}

function buildDisc(radius, color, seg, y = 0, opts = {}) {
  const pts = Array.from({ length: seg }, (_, i) => {
    const a = (i / seg) * Math.PI * 2;
    return [Math.cos(a) * radius, y, Math.sin(a) * radius];
  });
  return new MeshBuilder().color(color, opts).face(pts, [0, 1, 0]).build();
}

function disc(b, x, y, z, radius, seg) {
  const pts = Array.from({ length: seg }, (_, i) => {
    const a = (i / seg) * Math.PI * 2;
    return [x + Math.cos(a) * radius, y, z + Math.sin(a) * radius];
  });
  b.face(pts, [0, 1, 0]);
}

function buildCourse(hole, rail) {
  const b = new MeshBuilder();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of hole.outline) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  // Stone terrace around the course.
  const PAD = 14;
  b.color('#c4b9a6').box((x0 + x1) / 2, BASE_Y - 1.5, (y0 + y1) / 2, x1 - x0 + PAD * 2, 0.5, y1 - y0 + PAD * 2, { bottom: false });
  b.color('#aea38f');
  for (let x = x0 - PAD + 12; x < x1 + PAD; x += 12) b.box(x, BASE_Y - 1, (y0 + y1) / 2, 0.6, 0.1, y1 - y0 + PAD * 2, { bottom: false });
  for (let y = y0 - PAD + 12; y < y1 + PAD; y += 12) b.box((x0 + x1) / 2, BASE_Y - 1, y, x1 - x0 + PAD * 2, 0.1, 0.6, { bottom: false });
  // Green: mown stripes; slopes a lighter shade.
  for (let y = y0; y < y1; y += CELL) {
    for (let x = x0; x < x1; x += CELL) {
      const cx = x + CELL / 2;
      const cy = y + CELL / 2;
      if (!inPolygon(hole.outline, cx, cy)) continue;
      const slope = hole.slopes.some((s) => inRect(s, cx, cy));
      const stripe = Math.floor(x / 20) % 2 === 0;
      b.color(slope ? (stripe ? '#58b85a' : '#62c463') : stripe ? '#2f9e4f' : '#36ab57');
      b.face([[x, 0, y], [x, 0, y + CELL], [x + CELL, 0, y + CELL], [x + CELL, 0, y]], [0, 1, 0]);
    }
  }
  // Slope arrows (downhill direction).
  for (const s of hole.slopes) {
    const len = Math.hypot(s.gx, s.gy) || 1;
    const dx = s.gx / len;
    const dy = s.gy / len;
    b.color('#8fc86a');
    for (let ay = s.y + 12; ay < s.y + s.h - 6; ay += 22) {
      for (let ax = s.x + 14; ax < s.x + s.w - 6; ax += 26) {
        chevron(b, ax, ay, dx, dy);
      }
    }
  }
  b.color('#e6cf8e');
  for (const s of hole.sand) b.face([[s.x, 0.15, s.y], [s.x, 0.15, s.y + s.h], [s.x + s.w, 0.15, s.y + s.h], [s.x + s.w, 0.15, s.y]], [0, 1, 0]);
  b.color('#2f86c8', { emissive: 0.1 });
  for (const w of hole.water) b.face([[w.x, 0.2, w.y], [w.x, 0.2, w.y + w.h], [w.x + w.w, 0.2, w.y + w.h], [w.x + w.w, 0.2, w.y]], [0, 1, 0]);
  b.color('#bfe4ff');
  for (const w of hole.water) {
    for (let k = 0; k < 3; k++) {
      const wx = w.x + w.w * (0.25 + k * 0.25);
      const wy = w.y + w.h * (0.3 + ((k * 37) % 5) * 0.1);
      b.face([[wx - 4, 0.3, wy], [wx - 4, 0.3, wy + 0.8], [wx + 4, 0.3, wy + 0.8], [wx + 4, 0.3, wy]], [0, 1, 0]);
    }
  }
  // Tee mat and cup.
  b.color('#1d6b3c').box(hole.tee[0], 0, hole.tee[1], 12, 0.25, 10, { bottom: false });
  b.color('#f4f4f4').box(hole.tee[0] - 5, 0.25, hole.tee[1] - 4, 1.2, 0.6, 1.2).box(hole.tee[0] - 5, 0.25, hole.tee[1] + 4, 1.2, 0.6, 1.2);
  b.color('#f4f4ff');
  disc(b, hole.cup[0], 0.22, hole.cup[1], CUP_R + 0.9, 12);
  b.color('#04040a');
  disc(b, hole.cup[0], 0.3, hole.cup[1], CUP_R, 12);
  b.color('#f4f4ff').cylinder(hole.cup[0], 0, hole.cup[1], 0.45, FLAG_H, 6);

  // Walls along the outline, on the outside of each edge.
  const o = hole.outline;
  for (let i = 0; i < o.length; i++) wallAlong(b, hole, o[i], o[(i + 1) % o.length], rail);
  for (const k of hole.blocks) {
    // Stone obstacles with a lighter coping.
    b.color('#8f8578').box(k.x + k.w / 2, BASE_Y, k.y + k.h / 2, k.w, WALL_H - BASE_Y + 1, k.h, { top: '#a89e90' });
    b.color('#b8ae9f').box(k.x + k.w / 2, WALL_H + 1, k.y + k.h / 2, k.w - 3, 0.5, k.h - 3, { bottom: false });
  }
  return b.build();
}

function wallAlong(b, hole, [ax, ay], [bx, by], rail) {
  const len = Math.hypot(bx - ax, by - ay);
  const dx = (bx - ax) / len;
  const dy = (by - ay) / len;
  // Outward normal: the side that is not on the course.
  let nx = dy;
  let ny = -dx;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  if (inPolygon(hole.outline, mx + nx, my + ny)) { nx = -nx; ny = -ny; }
  // Extend past convex corners so they close; not into the course at inner corners.
  const convex = (px, py, sx) => !onCourse(hole, px + dx * sx * 0.5 - nx * 0.5, py + dy * sx * 0.5 - ny * 0.5);
  const extA = convex(ax, ay, -1) ? WALL_T : 0;
  const extB = convex(bx, by, 1) ? WALL_T : 0;
  const start = -extA;
  const end = len + extB;
  const cx = ax + dx * (start + end) / 2 + nx * WALL_T / 2;
  const cy = ay + dy * (start + end) / 2 + ny * WALL_T / 2;
  const yaw = Math.atan2(-dy, dx);
  b.color(rail[0]).orientedBox(cx, BASE_Y, cy, end - start, WALL_H - BASE_Y, WALL_T, yaw);
  b.color(rail[1]).orientedBox(cx, WALL_H, cy, end - start, 0.6, WALL_T, yaw);
}

function chevron(b, x, y, dx, dy) {
  // An arrow head pointing along (dx, dy), flat on the green.
  const px = -dy;
  const py = dx;
  const tip = [x + dx * 4, 0.12, y + dy * 4];
  const l = [x - dx * 2 + px * 4, 0.12, y - dy * 2 + py * 4];
  const rr = [x - dx * 2 - px * 4, 0.12, y - dy * 2 - py * 4];
  const c = [x, 0.12, y];
  b.face([tip, l, c], [0, 1, 0]);
  b.face([tip, c, rr], [0, 1, 0]);
}

function buildBumper(radius) {
  const b = new MeshBuilder();
  b.color('#d62828').cylinder(0, -0.5, 0, radius, 2.4, 14);
  b.color('#f4f4f4').cylinder(0, 1.9, 0, radius, 2, 14);
  b.color('#d62828').cylinder(0, 3.9, 0, radius, 1.6, 14, { top: '#f4f4f4' });
  b.color('#f4f4f4').cylinder(0, 5.5, 0, radius * 0.45, 1, 10);
  return b.build();
}

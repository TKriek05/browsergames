// Pinguïnbotsen in 3D: a cold sea with icebergs and snowy mountains, the
// melting ice floe in the middle (rebuilt as it shrinks) and low-poly
// penguins with a scarf and hat in the player's colour. They waddle, lean
// into a dash and sink with a splash. Game (x, y) → 3D (x, height, y).
import { createRenderer3D } from '../../js/gl/renderer.js';
import { MeshBuilder } from '../../js/gl/mesh.js';
import { create, compose, yawFromDir } from '../../js/gl/mat4.js';
import { createParticles3D } from '../../js/gl/particles.js';
import { createRng } from '../../../shared/rng.js';
import { PG } from '../../../shared/games/penguins.js';

const TOP = 2; // height of the ice surface
const SEG = 40;
const MODEL_SCALE = 1.25; // penguins look a bit bigger than their hitbox

export function createPenguinScene(canvas, { reducedMotion }) {
  const r = createRenderer3D(canvas);
  if (!r) return null;
  r.setColors({
    sky: ['#7fb8e6', '#eaf5fb'],
    fog: ['#dcebf3', 500, 1500],
    light: { dir: [-0.5, -1, -0.35], color: '#fffaf0', ambient: '#9aa9ba' },
    sun: { dir: [0.5, 0.35, -0.6], radius: 0.05, top: '#fffbe8', bottom: '#ffe6b8' },
    clouds: { count: 10, color: '#ffffff', shade: '#dfe8f2', seed: 31 },
  });
  const world = r.mesh(buildWorld());
  const floe = r.mesh(new Float32Array(0));
  const body = r.mesh(buildPenguin());
  const shadow = r.mesh(new MeshBuilder().color('#1d3a4a').cylinder(0, 0, 0, PG.RADIUS * 0.95, 0.05, 14).build());
  const particles = createParticles3D(500, { reducedMotion });
  const m = create();
  let floeR = -1;
  let time = 0;
  let shake = 0;

  return {
    r,
    particles,

    update(dt) {
      time += dt;
      shake = Math.max(0, shake - dt * 10);
      particles.update(dt);
      if (!reducedMotion && Math.random() < 0.5) {
        // Light snowfall.
        particles.spawn((Math.random() - 0.5) * 400, 120, (Math.random() - 0.5) * 300, 0, -18, 0, 6, '#ffffff', 0.9, 0, 1);
      }
    },

    shake(n) {
      if (!reducedMotion) shake = Math.max(shake, n);
    },

    begin(radius) {
      if (Math.abs(radius - floeR) > 0.4) {
        floeR = radius;
        r.update(floe, buildFloe(radius));
      }
      const zoom = 0.55 + 0.45 * (radius / PG.FLOE_START);
      const sx = shake ? (Math.random() - 0.5) * shake : 0;
      r.camera(sx, 118 * zoom + 22, 190 * zoom + 34, 0, 0, 16 * zoom, 0.72, 5, 2200);
      if (!r.begin()) return false;
      compose(m, 0, 0, 0);
      r.draw(world, m);
      r.draw(floe, m);
      return true;
    },

    // A penguin at (x, y) facing (fx, fy). sink: 0 on the ice … 1 gone.
    penguin(x, y, fx, fy, speed, dashing, color, sink = 0) {
      const yaw = yawFromDir(fx, fy);
      const wobble = reducedMotion ? 0 : Math.sin(time * 11 + x * 0.1) * Math.min(1, speed / 40) * 0.14;
      const lean = dashing ? -0.35 : 0;
      const y0 = TOP - sink * 20;
      compose(m, x, y0, y, yaw, wobble, lean + sink * 0.9, MODEL_SCALE);
      r.draw(body, m, color);
      if (!sink && !r.shadows) {
        compose(m, x, TOP + 0.05, y);
        r.draw(shadow, m, undefined, 0.35);
      }
    },

    splash(x, y) {
      particles.burst(x, 0, y, [0.85, 0.94, 1], reducedMotion ? 8 : 34, { speed: 40, life: 0.9, size: 1.8, gravity: -70, up: 1 });
    },

    bump(x, y, power) {
      particles.burst(x, TOP + 6, y, [1, 1, 1], reducedMotion ? 4 : Math.min(24, 6 + power / 8), { speed: 26, life: 0.4, size: 1.2, gravity: -40, up: 0.5 });
      if (power > 120) shake = Math.max(shake, reducedMotion ? 0 : 3);
    },

    trail(x, y) {
      if (!reducedMotion) particles.spawn(x + (Math.random() - 0.5) * 4, TOP + 0.5, y + (Math.random() - 0.5) * 4, 0, 6, 0, 0.5, '#eef6ff', 1.3, -10, 0.9);
    },

    end() {
      particles.draw(r, 1.2, false);
    },

    project(x, y, h, out) {
      return r.project(x, h, y, out);
    },

    destroy() {
      r.destroy();
    },
  };
}

// --- Static world: the sea, icebergs, mountains ------------------------------------------
function buildWorld() {
  const b = new MeshBuilder();
  const rnd = createRng(77);
  b.color('#1d5874').face([[-2000, -2, -2000], [-2000, -2, 2000], [2000, -2, 2000], [2000, -2, -2000]], [0, 1, 0]);
  // Wave highlights.
  b.color('#2f7596');
  for (let i = 0; i < 160; i++) {
    const x = (rnd() - 0.5) * 1400;
    const z = (rnd() - 0.5) * 1100;
    if (Math.hypot(x, z) < PG.FLOE_START + 20) continue;
    const w = 8 + rnd() * 18;
    b.face([[x, -1.9, z], [x, -1.9, z + 1.2], [x + w, -1.9, z + 1.2], [x + w, -1.9, z]], [0, 1, 0]);
  }
  // Icebergs.
  for (let i = 0; i < 22; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 230 + rnd() * 420;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (z > 120 && Math.abs(x) < 260) continue; // keep the view from the camera free
    const size = 14 + rnd() * 34;
    b.color('#f2f8fc').cone(x, -2, z, size, size * (0.8 + rnd() * 0.9), 5 + Math.floor(rnd() * 3));
    b.color('#cfe6f2').cone(x + size * 0.4, -2, z + size * 0.2, size * 0.6, size * 0.7, 5);
  }
  // Snowy mountains far away.
  for (let k = 0; k < 26; k++) {
    const a = (k / 26) * Math.PI * 2;
    if (Math.sin(a) > 0.55) continue;
    const d = 1100;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const h = 160 + rnd() * 220;
    b.color('#8ea6b8').cone(x, -2, z, 140 + rnd() * 80, h, 5);
    b.color('#f4f8fb').cone(x, h * 0.62 - 2, z, (140 + 40) * 0.36, h * 0.38, 5);
  }
  return b.build();
}

// The floe: white top with a darker rim, icy sides reaching into the water.
function buildFloe(R) {
  const b = new MeshBuilder();
  const rnd = createRng(Math.round(R * 10));
  const ring = (rr, y) => Array.from({ length: SEG }, (_, i) => {
    const a = (i / SEG) * Math.PI * 2;
    const wob = 1 + Math.sin(a * 7) * 0.012 + Math.sin(a * 3 + 1) * 0.01;
    return [Math.cos(a) * rr * wob, y, Math.sin(a) * rr * wob];
  });
  const top = ring(R, TOP);
  const inner = ring(R - 6, TOP + 0.01);
  const bottom = ring(R * 0.94, -9);
  b.color('#eef5fa').face(inner, [0, 1, 0]);
  for (let i = 0; i < SEG; i++) {
    const j = (i + 1) % SEG;
    b.color(i % 3 ? '#e4f0f7' : '#d8e9f3').face([inner[i], top[i], top[j], inner[j]], [0, 1, 0]);
    const n = [(top[i][0] + top[j][0]) / 2, 0, (top[i][2] + top[j][2]) / 2];
    b.color(i % 2 ? '#bfe0ef' : '#b2d8ea').face([top[i], bottom[i], bottom[j], top[j]], n);
  }
  // A few cracks and snow lumps.
  b.color('#c7dcea');
  for (let k = 0; k < 7; k++) {
    const a = rnd() * Math.PI * 2;
    const r0 = R * (0.35 + rnd() * 0.4);
    const x = Math.cos(a) * r0;
    const z = Math.sin(a) * r0;
    const len = 10 + rnd() * 16;
    const dx = Math.cos(a + 0.6) * len;
    const dz = Math.sin(a + 0.6) * len;
    b.face([[x, TOP + 0.03, z], [x + dx, TOP + 0.03, z + dz], [x + dx + 0.9, TOP + 0.03, z + dz + 0.9], [x + 0.9, TOP + 0.03, z + 0.9]], [0, 1, 0]);
  }
  b.color('#ffffff');
  for (let k = 0; k < 9; k++) {
    const a = rnd() * Math.PI * 2;
    const r0 = R * (0.5 + rnd() * 0.4);
    b.sphere(Math.cos(a) * r0, TOP - 0.6, Math.sin(a) * r0, 2 + rnd() * 2.5, 6, 3);
  }
  return b.build();
}

// --- The penguin (facing +x, feet at y = 0) ----------------------------------------------------
function buildPenguin() {
  const b = new MeshBuilder();
  // Feet and body.
  b.color('#f29a2e').box(1.8, 0, -1.8, 3.4, 0.8, 2.2).box(1.8, 0, 1.8, 3.4, 0.8, 2.2);
  b.color('#23252d').sphere(-0.4, 6.2, 0, 5.4, 9, 6);
  b.color('#f7f7f2').sphere(1.4, 6, 0, 4.4, 9, 6); // belly
  // Flippers.
  b.color('#1b1d23').orientedBox(-0.5, 4, -5.2, 2, 5.5, 0.9, 0).orientedBox(-0.5, 4, 5.2, 2, 5.5, 0.9, 0);
  // Head, eyes, beak.
  b.color('#23252d').sphere(0.2, 12.6, 0, 3.6, 8, 6);
  b.color('#ffffff').sphere(2.7, 13.4, -1.3, 0.9, 5, 4).sphere(2.7, 13.4, 1.3, 0.9, 5, 4);
  b.color('#101014').sphere(3.4, 13.4, -1.3, 0.45, 4, 3).sphere(3.4, 13.4, 1.3, 0.45, 4, 3);
  b.color('#f29a2e');
  const tip = [6.4, 12.2, 0];
  const base = [[3.2, 12.9, -0.9], [3.2, 12.9, 0.9], [3.2, 11.6, 0.9], [3.2, 11.6, -0.9]];
  for (let i = 0; i < 4; i++) {
    const a = base[i];
    const c = base[(i + 1) % 4];
    b.face([a, c, tip], [1, (a[1] + c[1]) / 2 - 12.2, (a[2] + c[2]) / 2]);
  }
  // Scarf and bobble hat in the player's colour.
  b.color('#ffffff', { tint: 1 }).cylinder(0, 9.4, 0, 4.4, 1.6, 12);
  b.color('#ffffff', { tint: 1 }).box(-3.4, 6.2, 1.6, 1.2, 3.4, 1.4);
  b.color('#ffffff', { tint: 1 }).cylinder(0, 15, 0, 3.2, 1.6, 10);
  b.color('#ffffff', { tint: 0.4 }).cylinder(0, 14.6, 0, 3.4, 0.6, 10);
  b.color('#ffffff').sphere(0, 17.3, 0, 1.1, 5, 4);
  return b.build();
}


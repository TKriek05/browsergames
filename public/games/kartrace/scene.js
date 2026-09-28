// Neon Kart GP in 3D: synthwave scenery (grid floor, mountains, retro sun),
// the track built from the shared centre line (road, curbs, glowing
// barriers, finish gantry, boost pads), low-poly karts and a chase camera.
// World mapping: track (x, y) → 3D (x, 0, y).
import { createRenderer3D } from '../../js/gl/renderer.js';
import { MeshBuilder, rgb } from '../../js/gl/mesh.js';
import { create, compose, yawFromDir } from '../../js/gl/mat4.js';
import { createParticles3D } from '../../js/gl/particles.js';
import { WALL_MARGIN, pointAt } from '../../../shared/maps/kart-tracks.js';
import { KART_PHYS } from '../../../shared/physics/kart.js';

const ROAD_Y = 0.25;
const BARRIER_H = 6;

export function createKartScene(canvas, { reducedMotion }) {
  const r = createRenderer3D(canvas);
  if (!r) return null;
  const m = create();
  const kart = r.mesh(buildKart());
  const box = r.mesh(new MeshBuilder().color('#ffffff', { emissive: 0.55, tint: 1 }).box(0, -4, 0, 8, 8, 8, { top: '#ffffff' })
    .color('#ffffff', { emissive: 1 }).box(0, 4, 0, 3, 0.4, 3).build());
  const orb = r.mesh(new MeshBuilder().color('#ff3ea5', { emissive: 1 }).octa(0, 0, 0, 4, 4).build());
  const oil = r.mesh(buildOil());
  const shadow = r.mesh(buildShadow());
  const shield = r.mesh(new MeshBuilder().color('#5dff8a', { emissive: 0.8 }).sphere(0, 0, 0, 10, 8, 5).build());
  const particles = createParticles3D(700, { reducedMotion });
  let world = null;
  let track = null;
  let time = 0;
  const cam = { x: 0, y: 30, z: 0, lx: 0, ly: 0, lz: 0, fov: 1.05, ready: false };

  return {
    r,
    particles,

    setTrack(t) {
      if (track === t) return;
      track = t;
      if (world) r.free(world);
      world = r.mesh(buildWorld(t));
      const c = t.colors;
      r.setColors({
        sky: c.sky,
        fog: [c.sky[0], 900, 2600],
        light: { dir: [-0.4, -1, 0.25], color: '#f0e8ff', ambient: '#5a5078' },
        sun: { dir: [0.0, 0.1, -1], radius: 0.2, top: c.sun[0], bottom: c.sun[1] },
      });
      cam.ready = false;
    },

    update(dt) {
      time += dt;
      particles.update(dt);
    },

    // Chase camera behind (x, y, heading). mode: 'chase' | 'orbit'.
    camera(x, y, hx, hy, speed01, boost, dt, mode = 'chase') {
      let tx, ty, tz, lx, lz;
      if (mode === 'orbit') {
        const a = time * 0.4;
        tx = x + Math.cos(a) * 46;
        tz = y + Math.sin(a) * 46;
        ty = 18;
        lx = x;
        lz = y;
      } else {
        tx = x - hx * 30;
        tz = y - hy * 30;
        ty = 12.5;
        lx = x + hx * 24;
        lz = y + hy * 24;
      }
      const k = cam.ready ? 1 - Math.exp(-dt * 7) : 1;
      const kl = cam.ready ? 1 - Math.exp(-dt * 12) : 1;
      cam.x += (tx - cam.x) * k;
      cam.y += (ty - cam.y) * k;
      cam.z += (tz - cam.z) * k;
      cam.lx += (lx - cam.lx) * kl;
      cam.ly += (3.5 - cam.ly) * kl;
      cam.lz += (lz - cam.lz) * kl;
      const fov = 1.02 + speed01 * 0.1 + (boost ? 0.12 : 0);
      cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 4));
      cam.ready = true;
      r.camera(cam.x, cam.y, cam.z, cam.lx, cam.ly, cam.lz, cam.fov, 2, 3200);
    },

    begin() {
      if (!r.begin()) return false;
      if (world) {
        compose(m, 0, 0, 0);
        r.draw(world, m);
      }
      return true;
    },

    // drift: -1/0/1 (the body swings into the slide), steer banks it a little.
    kart(x, y, hx, hy, color, { drift = 0, steer = 0, spin = 0, flash = 0 } = {}) {
      const yaw = yawFromDir(hx, hy) - drift * 0.38 + (spin > 0 ? time * 14 : 0);
      const bank = drift * 0.1 + steer * 0.05;
      compose(m, x, 0.3, y, yaw, bank, 0, 1);
      r.draw(kart, m, color, 1, flash);
    },

    itemBox(x, y, hue) {
      const bob = reducedMotion ? 0 : Math.sin(time * 3 + x * 0.1) * 1.2;
      compose(m, x, 9 + bob, y, time * 1.5, 0.5, 0.6);
      r.draw(box, m, hue);
    },

    orb(x, y) {
      compose(m, x, 4, y, time * 10);
      r.draw(orb, m);
      if (!reducedMotion) particles.spawn(x, 4, y, 0, 0, 0, 0.35, '#ff3ea5', 1.5, 0, 1);
    },

    oil(x, y) {
      compose(m, x, ROAD_Y + 0.08, y);
      r.draw(oil, m);
    },

    shadow(x, y) {
      compose(m, x, ROAD_Y + 0.1, y);
      r.draw(shadow, m, [1, 1, 1], 0.4);
    },

    shield(x, y) {
      compose(m, x, 4, y, time);
      r.draw(shield, m, [1, 1, 1], 0.25);
    },

    // Exhaust flames, drift sparks, dust on the grass.
    effects(x, y, hx, hy, { boost, drift, charge, off, v }) {
      if (reducedMotion) return;
      const bx = x - hx * 8;
      const by = y - hy * 8;
      if (boost > 0 && Math.random() < 0.9) {
        particles.spawn(bx, 2.6, by, -hx * 30 + (Math.random() - 0.5) * 10, 3, -hy * 30 + (Math.random() - 0.5) * 10, 0.22, Math.random() < 0.5 ? '#ffd23e' : '#ff6a2a', 1.3, 0, 0.9);
      }
      if (drift !== 0 && charge > KART_PHYS.CHARGE_1 * 0.5) {
        const color = charge >= KART_PHYS.CHARGE_2 ? '#ff9a3e' : charge >= KART_PHYS.CHARGE_1 ? '#3ef0ff' : '#ffffff';
        for (const side of [-1, 1]) {
          particles.spawn(bx - hy * 4.5 * side, 1.2, by + hx * 4.5 * side, (Math.random() - 0.5) * 30, 12 + Math.random() * 12, (Math.random() - 0.5) * 30, 0.22, color, 0.8, -60, 0.95);
        }
      }
      if (off && Math.abs(v) > 30 && Math.random() < 0.7) {
        particles.spawn(bx, 1, by, (Math.random() - 0.5) * 16, 8 + Math.random() * 6, (Math.random() - 0.5) * 16, 0.45, '#6a8a3a', 1.2, -20, 0.95);
      }
    },

    burst(x, y, color, n = 24) {
      particles.burst(x, 4, y, color, n, { speed: 45, life: 0.6, size: 1.4, gravity: -40, up: 0.7 });
    },

    endParticles() {
      particles.draw(r, 1);
    },

    project(x, y, h, out) {
      return r.project(x, h, y, out);
    },

    destroy() {
      r.destroy();
    },
  };
}

// --- Meshes ------------------------------------------------------------------------
function buildKart() {
  const b = new MeshBuilder();
  b.color('#26263a').box(0, 0.8, 0, 13.5, 1.4, 8.4);
  b.color('#ffffff', { tint: 1 }).box(-1.2, 2.2, 0, 8.5, 2.3, 6.4, { top: '#ffffff' });
  b.color('#e0e0e0', { tint: 1 }).wedge(5.2, 1.6, 0, 5.4, 2, 6, 1.5);
  b.color('#ffffff', { emissive: 1, tint: 1 }).box(-1.2, 3.2, 3.25, 7.6, 0.6, 0.2).box(-1.2, 3.2, -3.25, 7.6, 0.6, 0.2);
  // Spoiler
  b.color('#2c2c40').box(-6.2, 3.5, 2.4, 0.8, 2.4, 0.6).box(-6.2, 3.5, -2.4, 0.8, 2.4, 0.6);
  b.color('#ffffff', { tint: 1 }).box(-6.4, 5.8, 0, 2.4, 0.6, 9);
  // Wheels
  b.color('#15151f');
  for (const [wx, wz] of [[4.3, 4.7], [4.3, -4.7], [-4.4, 4.9], [-4.4, -4.9]]) b.wheel(wx, 2.2, wz, 2.2, 2.2, 8, '#8a8fb8');
  // Driver: helmet + visor
  b.color('#f4f4ff').sphere(-1.8, 6.3, 0, 2.2, 8, 5);
  b.color('#3ef0ff', { emissive: 1 }).box(-0.2, 5.9, 0, 0.8, 1, 3);
  // Exhausts
  b.color('#ff9a3e', { emissive: 1 }).box(-7, 2.1, 1.8, 0.6, 0.9, 0.9).box(-7, 2.1, -1.8, 0.6, 0.9, 0.9);
  return b.build();
}

function buildOil() {
  const b = new MeshBuilder();
  const ring = (rad, y) => Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2;
    return [Math.cos(a) * rad * (1 + 0.15 * Math.sin(i * 2.3)), y, Math.sin(a) * rad];
  });
  b.color('#c77dff', { emissive: 0.9 }).face(ring(13, 0), [0, 1, 0]);
  b.color('#1a0a2a').face(ring(11, 0.05), [0, 1, 0]);
  return b.build();
}

function buildShadow() {
  const pts = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    return [Math.cos(a) * 9, 0, Math.sin(a) * 6.5];
  });
  return new MeshBuilder().color('#000000').face(pts, [0, 1, 0]).build();
}

// Everything static for one track in a single mesh.
function buildWorld(t) {
  const b = new MeshBuilder();
  const c = t.colors;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < t.count; i++) {
    minX = Math.min(minX, t.px[i]); maxX = Math.max(maxX, t.px[i]);
    minY = Math.min(minY, t.py[i]); maxY = Math.max(maxY, t.py[i]);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const size = Math.max(maxX - minX, maxY - minY) + 3200;

  // Ground + synthwave grid
  b.color(c.ground).box(cx, -1, cy, size, 1, size);
  b.color(c.grid, { emissive: 0.55 });
  const step = 80;
  const x0 = Math.floor((cx - size / 2) / step) * step;
  const y0 = Math.floor((cy - size / 2) / step) * step;
  for (let x = x0; x <= cx + size / 2; x += step) b.box(x, 0, cy, 1.6, 0.05, size, { bottom: false });
  for (let y = y0; y <= cy + size / 2; y += step) b.box(cx, 0, y, size, 0.05, 1.6, { bottom: false });

  // Mountains on the horizon
  const radius = size / 2 - 300;
  for (let i = 0; i < 48; i++) {
    const a0 = (i / 48) * Math.PI * 2;
    const a1 = ((i + 1) / 48) * Math.PI * 2;
    const h = 140 + ((i * 37) % 11) * 26;
    const px = (a) => cx + Math.cos(a) * radius;
    const pz = (a) => cy + Math.sin(a) * radius;
    const am = (a0 + a1) / 2;
    const inward = [-(Math.cos(am)), 0, -Math.sin(am)];
    b.color('#1c0d36').face([[px(a0 - 0.04), 0, pz(a0 - 0.04)], [px(a1 + 0.04), 0, pz(a1 + 0.04)], [px(am), h, pz(am)]], inward);
    b.color(c.grid, { emissive: 0.8 }).face([[px(am) - Math.sin(am) * 3, h - 1, pz(am) + Math.cos(am) * 3], [px(am) + Math.sin(am) * 3, h - 1, pz(am) - Math.cos(am) * 3], [px(am), h + 3, pz(am)]], inward);
  }

  // Road, curbs, centre dashes
  const edge = (off, y) => {
    const pts = [];
    for (let i = 0; i < t.count; i++) pts.push([t.px[i] - t.ty[i] * off, y, t.py[i] + t.tx[i] * off]);
    return pts;
  };
  const L = edge(-t.half, ROAD_Y);
  const Rr = edge(t.half, ROAD_Y);
  b.color('#2c2a44').ribbon(L, Rr, (i) => ((i >> 2) % 2 ? '#2c2a44' : '#302e4b'), true);
  b.ribbon(edge(-t.half - 7, ROAD_Y), L, (i) => ((i >> 1) % 2 ? '#ff4d6d' : '#f4f4ff'), true);
  b.ribbon(Rr, edge(t.half + 7, ROAD_Y), (i) => ((i >> 1) % 2 ? '#ff4d6d' : '#f4f4ff'), true);
  const dashL = edge(-0.9, ROAD_Y + 0.03);
  const dashR = edge(0.9, ROAD_Y + 0.03);
  b.color('#8a86c8', { emissive: 0.6 });
  for (let i = 0; i < t.count; i += 4) {
    const j = (i + 2) % t.count;
    b.face([dashL[i], dashR[i], dashR[j], dashL[j]], [0, 1, 0]);
  }

  // Barriers: dark walls with a glowing top strip, alternating colours.
  const lim = t.half + WALL_MARGIN;
  for (const side of [-1, 1]) {
    const line = edge(side * lim, 0).map(([x, , z]) => [x, z]);
    b.color('#150c2a').wall(line, 0, BARRIER_H, true);
    const inner = edge(side * (lim - 1.2), BARRIER_H);
    const outer = edge(side * (lim + 1.2), BARRIER_H);
    // ribbon() only swaps colours per segment, so the emissive setting stays on.
    b.color(c.barrier[0], { emissive: 1 });
    b.ribbon(side < 0 ? outer : inner, side < 0 ? inner : outer, (i) => (Math.floor(i / 6) % 2 ? c.barrier[0] : c.barrier[1]), true);
  }

  // Light posts outside the barriers
  for (let i = 0; i < t.count; i += 14) {
    for (const side of [-1, 1]) {
      const off = side * (lim + 16);
      const x = t.px[i] - t.ty[i] * off;
      const z = t.py[i] + t.tx[i] * off;
      b.color('#241a44').box(x, 0, z, 3, 26, 3, { bottom: false });
      b.color(c.barrier[side < 0 ? 0 : 1], { emissive: 1 }).box(x, 26, z, 4.5, 3, 4.5);
    }
  }

  // Finish line: checkerboard + gantry
  const f0 = pointAt(t, 0);
  const cells = 10;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < cells; col++) {
      const a = -t.half + (col / cells) * t.half * 2;
      const bb = a + (t.half * 2) / cells;
      const d0 = row * 5;
      const d1 = d0 + 5;
      const P = (lat, d) => [f0.x + f0.tx * d - f0.ty * lat, ROAD_Y + 0.06, f0.y + f0.ty * d + f0.tx * lat];
      b.color((row + col) % 2 ? '#f4f4ff' : '#10101a').face([P(a, d0), P(bb, d0), P(bb, d1), P(a, d1)], [0, 1, 0]);
    }
  }
  const post = (lat) => [f0.x - f0.ty * lat, f0.y + f0.tx * lat];
  for (const lat of [-(t.half + 12), t.half + 12]) {
    const [x, z] = post(lat);
    b.color('#2a2250').box(x, 0, z, 4, 30, 4);
  }
  const [gx, gz] = post(0);
  const yaw = yawFromDir(f0.tx, f0.ty);
  const span = (t.half + 12) * 2;
  b.color('#2a2250').orientedBox(gx, 30, gz, 4, 6, span, yaw);
  b.color(c.barrier[0], { emissive: 1 }).orientedBox(gx, 31, gz, 4.6, 4, span * 0.6, yaw);

  // Boost pads: glowing chevrons pointing along the track.
  for (const pad of t.pads) {
    const fx = pad.dx;
    const fy = pad.dy;
    const nx = -fy;
    const ny = fx;
    for (let k = 0; k < 3; k++) {
      const d = (k - 1) * 9;
      const tip = [pad.x + fx * (d + 5), ROAD_Y + 0.05, pad.y + fy * (d + 5)];
      const l = [pad.x + fx * (d - 3) + nx * 9, ROAD_Y + 0.05, pad.y + fy * (d - 3) + ny * 9];
      const rr = [pad.x + fx * (d - 3) - nx * 9, ROAD_Y + 0.05, pad.y + fy * (d - 3) - ny * 9];
      const mid = [pad.x + fx * d, ROAD_Y + 0.05, pad.y + fy * d];
      b.color('#ffd23e', { emissive: 1 }).face([tip, l, mid], [0, 1, 0]).face([tip, mid, rr], [0, 1, 0]);
    }
  }
  return b.build();
}

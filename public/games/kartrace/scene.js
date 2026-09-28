// Turbo Kart GP in 3D: a daytime circuit per track theme (grass or sand,
// hills, trees, a grandstand, clouds and a real sun), the track built from
// the shared centre line (asphalt, kerbs, painted barriers, start gantry,
// boost pads), low-poly karts and a chase camera.
// World mapping: track (x, y) → 3D (x, 0, y).
import { createRenderer3D } from '../../js/gl/renderer.js';
import { MeshBuilder } from '../../js/gl/mesh.js';
import { create, compose, yawFromDir } from '../../js/gl/mat4.js';
import { createParticles3D } from '../../js/gl/particles.js';
import { KART_PHYS } from '../../../shared/physics/kart.js';
import { buildWorld, ROAD_Y } from './world.js';


export function createKartScene(canvas, { reducedMotion }) {
  const r = createRenderer3D(canvas);
  if (!r) return null;
  const m = create();
  const kart = r.mesh(buildKart());
  const box = r.mesh(new MeshBuilder().color('#ffffff', { emissive: 0.3, tint: 1 }).box(0, -4, 0, 8, 8, 8, { top: '#ffffff' })
    .color('#ffffff', { emissive: 0.6 }).box(0, 4, 0, 3, 0.4, 3).build());
  const orb = r.mesh(new MeshBuilder().color('#ff5a36', { emissive: 0.25 }).sphere(0, 0, 0, 3.6, 8, 5)
    .color('#fff4e0').box(0, -0.4, 0, 7.4, 0.8, 1.2).build());
  const oil = r.mesh(buildOil());
  const shadow = r.mesh(buildShadow());
  const shield = r.mesh(new MeshBuilder().color('#7de0ff', { emissive: 0.6 }).sphere(0, 0, 0, 10, 8, 5).build());
  const particles = createParticles3D(700, { reducedMotion });
  let world = null;
  let track = null;
  let time = 0;
  let dust = '#a89a70';
  const cam = { x: 0, y: 30, z: 0, lx: 0, ly: 0, lz: 0, fov: 1.05, ready: false };

  return {
    r,
    particles,

    setTrack(t) {
      if (track === t) return;
      track = t;
      if (world) r.free(world);
      world = r.mesh(buildWorld(t));
      const th = t.theme;
      const [sx, sy, sz] = th.sunDir;
      r.setColors({
        sky: th.sky,
        fog: [th.fog, 1100, 3000],
        light: { dir: [-sx, -1.2, -sz], color: th.light.color, ambient: th.light.ambient },
        sun: { dir: th.sunDir, radius: 0.07, top: th.sun[0], bottom: th.sun[1] },
        clouds: { count: th.clouds, color: '#ffffff', shade: th.fog, seed: t.count },
      });
      dust = th.edge;
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
      compose(m, x, 3.8, y, time * 10, time * 6);
      r.draw(orb, m);
      if (!reducedMotion && Math.random() < 0.4) particles.spawn(x, 1, y, 0, 3, 0, 0.3, dust, 1.2, 0, 1);
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
        particles.spawn(bx, 1, by, (Math.random() - 0.5) * 16, 8 + Math.random() * 6, (Math.random() - 0.5) * 16, 0.45, dust, 1.2, -20, 0.95);
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
  b.color('#f4f4f4').box(-1.2, 3.2, 3.25, 7.6, 0.6, 0.2).box(-1.2, 3.2, -3.25, 7.6, 0.6, 0.2);
  // Spoiler
  b.color('#2c2c40').box(-6.2, 3.5, 2.4, 0.8, 2.4, 0.6).box(-6.2, 3.5, -2.4, 0.8, 2.4, 0.6);
  b.color('#ffffff', { tint: 1 }).box(-6.4, 5.8, 0, 2.4, 0.6, 9);
  // Wheels
  b.color('#15151f');
  for (const [wx, wz] of [[4.3, 4.7], [4.3, -4.7], [-4.4, 4.9], [-4.4, -4.9]]) b.wheel(wx, 2.2, wz, 2.2, 2.2, 8, '#8a8fb8');
  // Driver: helmet + visor
  b.color('#f4f4ff').sphere(-1.8, 6.3, 0, 2.2, 8, 5);
  b.color('#1d2b3c').box(-0.2, 5.9, 0, 0.8, 1, 3);
  // Exhausts
  b.color('#8a8a92').box(-6.9, 2.1, 1.8, 0.8, 1, 1).box(-6.9, 2.1, -1.8, 0.8, 1, 1);
  return b.build();
}

function buildOil() {
  const b = new MeshBuilder();
  const ring = (rad, y) => Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2;
    return [Math.cos(a) * rad * (1 + 0.15 * Math.sin(i * 2.3)), y, Math.sin(a) * rad];
  });
  b.color('#3a3446').face(ring(13, 0), [0, 1, 0]);
  b.color('#15121c').face(ring(11, 0.05), [0, 1, 0]);
  b.color('#5a5470').face(ring(3, 0.1).map(([x, y, z]) => [x - 4, y, z - 2]), [0, 1, 0]);
  return b.build();
}

function buildShadow() {
  const pts = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    return [Math.cos(a) * 9, 0, Math.sin(a) * 6.5];
  });
  return new MeshBuilder().color('#000000').face(pts, [0, 1, 0]).build();
}

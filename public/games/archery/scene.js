// Raak de Roos in 3D: a grass archery range on a summer afternoon. One lane
// per player with a straw target on a wooden stand, flags that show the
// wind, trees and a grass bank behind the targets, archers on the shooting
// line and the arrows (flying, or stuck in the face or the grass).
// Lane metres → world: x = lane centre + x, y = y, z = -distance (the range
// runs along -z, so "right" on screen is +x). 1 m = S world units.
import { createRenderer3D } from '../../js/gl/renderer.js';
import { MeshBuilder, rgb } from '../../js/gl/mesh.js';
import { create, compose, yawFromDir } from '../../js/gl/mat4.js';
import { createParticles3D } from '../../js/gl/particles.js';
import { createRng } from '../../../shared/rng.js';
import { ARC } from '../../../shared/games/archery.js';

export const S = 10;
const RANGE_M = 78; // grass bank behind the farthest targets
const RINGS = [['#f4f4f0', 10], ['#f4f4f0', 9], ['#1f1f22', 8], ['#1f1f22', 7], ['#2a8fd8', 6], ['#2a8fd8', 5], ['#e4453a', 4], ['#e4453a', 3], ['#ffd23e', 2], ['#ffd23e', 1]];

export const laneX = (lane) => (lane - (ARC.LANES - 1) / 2) * ARC.LANE_W;
// Lane-local metres → world units.
export function world(lane, x, y, z, out) {
  out[0] = (laneX(lane) + x) * S;
  out[1] = y * S;
  out[2] = -z * S;
  return out;
}

export function createArcheryScene(canvas, { reducedMotion }) {
  const r = createRenderer3D(canvas);
  if (!r) return null;
  r.setColors({
    sky: ['#5ea6e6', '#d9ecf7'],
    fog: ['#cfe3ee', 700, 2600],
    light: { dir: [-0.55, -1, 0.35], color: '#fff3dc', ambient: '#8c99a6' },
    sun: { dir: [0.55, 0.6, -0.35], radius: 0.045, top: '#fffbe8', bottom: '#ffe9b0' },
    clouds: { count: 12, color: '#ffffff', shade: '#dce8f2', seed: 19 },
    shadow: { span: 260, ahead: 0.2 },
  });
  const ground = r.mesh(buildGround());
  const target = r.mesh(buildTarget());
  const archer = r.mesh(buildArcher());
  const arrow = r.mesh(buildArrow());
  const pole = r.mesh(new MeshBuilder().color('#e8e4da').cylinder(0, 0, 0, 0.35, 55, 6).build());
  const flag = r.mesh(new MeshBuilder().color('#ffffff', { tint: 1 }).face([[0, 0, 0], [16, 0, 0], [16, -9, 0], [0, -9, 0]], [0, 0, 1]).face([[0, 0, 0], [0, -9, 0], [16, -9, 0], [16, 0, 0]], [0, 0, -1]).build());
  const particles = createParticles3D(300, { reducedMotion });
  const m = create();
  const p = [0, 0, 0];
  let time = 0;

  return {
    r,

    update(dt) {
      time += dt;
      particles.update(dt);
    },

    // cam: { eye: [x, y, z], at: [x, y, z] } in world units, fov in radians.
    begin(eye, at, fov) {
      r.camera(eye[0], eye[1], eye[2], at[0], at[1], at[2], fov, 2, 4000);
      if (!r.begin()) return false;
      compose(m, 0, 0, 0);
      r.draw(ground, m);
      return true;
    },

    target(lane, offset, dist) {
      world(lane, offset, 0, dist, p);
      compose(m, p[0], 0, p[2]);
      r.draw(target, m);
    },

    archer(lane, color, lean) {
      world(lane, 0, 0, 0, p);
      compose(m, p[0], 0, p[2] + 2, Math.PI / 2, 0, lean);
      r.draw(archer, m, color);
    },

    // An arrow with its tip at lane metres (x, y, z) flying along (dx, dy, dz).
    arrow(lane, x, y, z, dx, dy, dz, color) {
      world(lane, x, y, z, p);
      const yaw = yawFromDir(dx, -dz);
      const pitch = Math.atan2(dy, Math.hypot(dx, dz));
      compose(m, p[0], p[1], p[2], yaw, 0, pitch);
      r.draw(arrow, m, color);
    },

    // Flags along the range, blowing with the wind (m/s, + = to the right).
    flags(wind) {
      const strength = Math.min(1, Math.abs(wind) / 8);
      const droop = (1 - strength) * 1.1 + 0.08;
      const yaw = wind >= 0 ? 0 : Math.PI;
      for (const z of [8, 30, 55, 76]) {
        for (const side of [-1, 1]) {
          const x = side * ((ARC.LANES / 2) * ARC.LANE_W + 2);
          compose(m, x * S, 0, -z * S);
          r.draw(pole, m);
          const wave = reducedMotion ? 0 : Math.sin(time * (3 + strength * 5) + z) * 0.12 * (0.3 + strength);
          compose(m, x * S, 54, -z * S, yaw + wave, 0, -droop);
          r.draw(flag, m, side < 0 ? [0.95, 0.3, 0.25] : [1, 0.82, 0.2]);
        }
      }
    },

    // A little straw dust where an arrow lands.
    thud(lane, x, y, z) {
      world(lane, x, y, z, p);
      particles.burst(p[0], p[1], p[2] + 0.5, '#e8d49a', reducedMotion ? 4 : 12, { speed: 6, life: 0.5, size: 0.5, gravity: -12, up: 0.4 });
    },

    endParticles() {
      particles.draw(r, 0.6, false);
    },

    project(x, y, z, out) {
      return r.project(x, y, z, out);
    },

    destroy() {
      r.destroy();
    },
  };
}

// --- Static world ------------------------------------------------------------------------------
function buildGround() {
  const b = new MeshBuilder();
  const rnd = createRng(12);
  const half = (ARC.LANES / 2) * ARC.LANE_W;
  // Grass with mowed stripes along the range.
  b.color('#5f9a45').face([[-3000, -0.2, 800], [3000, -0.2, 800], [3000, -0.2, -4000], [-3000, -0.2, -4000]], [0, 1, 0]);
  for (let k = -8; k < 8; k++) {
    const x0 = k * ARC.LANE_W * S;
    b.color(k % 2 ? '#6aa94c' : '#629f46').face([[x0, 0, 60], [x0 + ARC.LANE_W * S, 0, 60], [x0 + ARC.LANE_W * S, 0, -RANGE_M * S], [x0, 0, -RANGE_M * S]], [0, 1, 0]);
  }
  // Shooting line, lane lines, distance lines every 10 m.
  b.color('#f4f4f0');
  const strip = (x0, z0, x1, z1) => b.face([[x0, 0.05, z0], [x1, 0.05, z0], [x1, 0.05, z1], [x0, 0.05, z1]], [0, 1, 0]);
  strip(-half * S - 20, 0.6, half * S + 20, -0.6);
  for (let k = 0; k <= ARC.LANES; k++) {
    const x = (k - ARC.LANES / 2) * ARC.LANE_W * S;
    strip(x - 0.4, 0, x + 0.4, -75 * S);
  }
  b.color('#e0e8d8');
  for (let d = 10; d <= 70; d += 10) strip(-half * S, -d * S + 0.3, half * S, -d * S - 0.3);
  // The grass bank behind the targets and a row of trees.
  b.color('#5a8f40').box(0, 0, -(RANGE_M + 4) * S, 2 * (half + 20) * S, 40, 60, { top: '#6aa24a' });
  for (let i = 0; i < 70; i++) {
    const x = (rnd() - 0.5) * 2 * (half + 60) * S;
    const z = -(RANGE_M + 12 + rnd() * 40) * S;
    tree(b, x, z, 40 + rnd() * 50, rnd);
  }
  // Trees along the sides.
  for (let i = 0; i < 40; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * (half + 8 + rnd() * 30) * S;
    const z = -(rnd() * 70) * S;
    tree(b, x, z, 45 + rnd() * 40, rnd);
  }
  // Behind the shooting line: a tent and benches.
  b.color('#f2f2ee').box(-half * S - 60, 0, 60, 80, 26, 60);
  b.color('#e4453a').cone(-half * S - 60, 26, 60, 60, 20, 4);
  b.color('#8a5a2b');
  for (const x of [-60, 0, 60]) b.box(x, 0, 90, 70, 4, 10).box(x, 4, 90, 70, 1.2, 14);
  return b.build();
}

function tree(b, x, z, h, rnd) {
  b.color('#6b4a2b').cylinder(x, 0, z, 3 + rnd() * 2, h * 0.45, 6);
  const leaves = ['#3f7f3a', '#4d8c3f', '#35713a'];
  b.color(leaves[Math.floor(rnd() * 3)]).sphere(x, h * 0.62, z, h * 0.32, 7, 5);
  b.color(leaves[Math.floor(rnd() * 3)]).sphere(x + h * 0.15, h * 0.78, z - 4, h * 0.22, 6, 4);
}

// Target: straw boss on a wooden stand, the face (rings) towards +z.
function buildTarget() {
  const b = new MeshBuilder();
  const cy = ARC.TARGET_H * S;
  const boss = 7.2; // half size of the straw boss (units)
  // Legs behind the boss, so they never cover the face.
  b.color('#8a5a2b');
  b.box(-5.8, 0, -4.4, 1.2, cy + boss - 2, 1.2).box(5.8, 0, -4.4, 1.2, cy + boss - 2, 1.2);
  b.box(0, 0, -8, 1.2, cy + 4, 1.2);
  b.color('#d9bf7a').box(0, cy - boss, -1.8, boss * 2, boss * 2, 3.6, { top: '#e6cf8f' });
  b.color('#c9ad66');
  for (let y = cy - boss + 1.5; y < cy + boss; y += 2.2) b.box(0, y, -1.8, boss * 2 + 0.1, 0.25, 3.7);
  // Face rings, outer first, each a little further forward.
  const seg = 40;
  RINGS.forEach(([color, ring], i) => {
    const rad = ring * ARC.RING * S;
    const z = 0.04 + i * 0.012;
    const pts = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      pts.push([Math.cos(a) * rad, cy + Math.sin(a) * rad, z]);
    }
    b.color(color).face(pts, [0, 0, 1]);
  });
  // The X: a thin black circle outline would be hard; a small darker gold dot.
  b.color('#e8b800').face(Array.from({ length: 16 }, (_, k) => {
    const a = (k / 16) * Math.PI * 2;
    return [Math.cos(a) * ARC.RING * 0.5 * S, cy + Math.sin(a) * ARC.RING * 0.5 * S, 0.2];
  }), [0, 0, 1]);
  return b.build();
}

// An archer facing +x holding a bow (tint = shirt colour).
function buildArcher() {
  const b = new MeshBuilder();
  b.color('#2d3038').box(0, 0, -1.3, 2, 8.5, 1.8).box(0, 0, 1.3, 2, 8.5, 1.8);
  b.color('#ffffff', { tint: 1 }).box(0, 8.5, 0, 2.8, 6, 5);
  b.color('#e8b894').sphere(0, 16.4, 0, 1.9, 7, 5);
  b.color('#5a3a22').box(-0.2, 17.4, 0, 3, 1, 3.2);
  b.color('#ffffff', { tint: 0.8 }).box(3, 13.2, -1.8, 6, 1.2, 1.2);
  b.color('#e8b894').box(6.2, 13.2, -1.8, 1, 1.2, 1.2);
  // The bow: an arc of wood in front of the left hand, and the string.
  b.color('#7a4a24');
  for (let k = -4; k < 4; k++) {
    const y0 = 13.2 + k * 1.3;
    const bend = 0.9 - ((k + 0.5) / 4) ** 2 * 0.9;
    b.box(6.6 + bend, y0, -1.8, 0.5, 1.4, 0.5);
  }
  b.color('#f4f4f0').box(5.2, 8, -1.8, 0.12, 10.4, 0.12);
  b.color('#8a5a2b').box(-1.8, 10, 0, 1.2, 6, 1.6); // quiver
  return b.build();
}

// An arrow along +x with the tip at the origin (80 cm).
function buildArrow() {
  const b = new MeshBuilder();
  const L = 8;
  b.color('#c49a62').box(-L / 2, -0.07, 0, L, 0.14, 0.14);
  b.color('#9aa3ad').box(0.15, -0.1, 0, 0.5, 0.2, 0.2);
  // Fletching and nock in the archer's colour (you mostly see arrows end-on).
  b.color('#ffffff', { tint: 1 });
  b.face([[-L + 0.2, 0, 0], [-L + 2, 0, 0], [-L + 0.4, 0.8, 0]], [0, 0, 1]).face([[-L + 0.2, 0, 0], [-L + 0.4, 0.8, 0], [-L + 2, 0, 0]], [0, 0, -1]);
  b.face([[-L + 0.2, 0, 0], [-L + 2, 0, 0], [-L + 0.4, -0.4, 0.7]], [0, -0.5, 1]).face([[-L + 0.2, 0, 0], [-L + 0.4, -0.4, -0.7], [-L + 2, 0, 0]], [0, -0.5, -1]);
  b.color('#ffffff', { tint: 1, emissive: 0.3 }).box(-L - 0.2, -0.2, 0, 0.45, 0.4, 0.4);
  return b.build();
}

export { rgb };

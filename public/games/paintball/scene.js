// Spetterveld in 3D: first-person camera (looking around and up/down), the
// field (world.js: also floors, stairs and buildings), players as low-poly
// paintballers in their colour (with walking legs and the paint of every hit
// on their jersey), flying paint balls, paint that stays where it lands on
// walls, floors and ceilings (splat.js), power-up pads and particles.
import { createRenderer3D } from '../../js/gl/renderer.js';
import { MeshBuilder, rgb } from '../../js/gl/mesh.js';
import { create, compose, yawFromDir } from '../../js/gl/mat4.js';
import { createParticles3D } from '../../js/gl/particles.js';
import { PB_PHYS, ceilingHeight } from '../../../shared/physics/paintball.js';
import { PB_POWERS } from '../../../shared/games/paintball.js';
import { buildWorld, buildNet } from './world.js';
import { pbTheme } from './theme.js';
import { addSplat } from './splat.js';
import { buildPad, buildPowerModels } from './powers.js';

const HIP = 7.5;
const CHUNK = 24; // splats per mesh
const MAX_CHUNKS = 10; // → at most 240 splats
const PAD_EMPTY = 255;
// Where the paint of a hit sits on the jersey (model space, facing +x).
const MARK_SPOTS = [[1.75, 11.6, -1.1], [1.75, 9.7, 1.3], [-1.75, 12, 0.5], [0.3, 10.4, 2.85]];
const MAX_BALLS = 48;
const BALL_SPEED = 650;
const FOV = 1.12;

export function createPaintScene(canvas, { arena, reducedMotion }) {
  const r = createRenderer3D(canvas);
  if (!r) return null;
  const th = pbTheme(arena.key);
  const W = arena.width;
  const H = arena.height;
  const span = Math.max(W, H);
  const far = Math.max(1000, span * 2.4);
  r.setColors({
    sky: th.sky,
    fog: [th.fog, (th.fogNear ?? 260) * (span / 420), Math.max(th.fogFar ?? 900, span * 1.9)],
    light: { dir: th.light.dir ?? [-0.45, -1, -0.3], color: th.light.color, ambient: th.light.ambient },
    sun: th.sun ?? { dir: [0.45, 0.62, 0.3], radius: 0.05, top: '#fffbe8', bottom: '#ffe9b0' },
    clouds: th.clouds,
  });
  const glow = th.night ? 0.45 : 0; // paint shines a little under the floodlights

  const world = r.mesh(buildWorld(arena, th));
  const net = r.mesh(buildNet(arena, th));
  const body = r.mesh(buildBody());
  const legL = r.mesh(buildLeg(-1.3));
  const legR = r.mesh(buildLeg(1.3));
  const gun = r.mesh(buildViewGun());
  const ball = r.mesh(new MeshBuilder().color('#ffffff', { tint: 1, emissive: glow }).sphere(0, 0, 0, 0.75, 6, 4).build());
  const markMeshes = MARK_SPOTS.map(([mx, my, mz]) => r.mesh(new MeshBuilder().color('#ffffff', { tint: 1, emissive: glow }).sphere(mx, my, mz, 1.25, 6, 4).build()));
  const pad = r.mesh(buildPad());
  const models = buildPowerModels().map((data) => r.mesh(data));
  const bubble = r.mesh(new MeshBuilder().color('#ffffff', { emissive: 0.6, tint: 1 }).sphere(0, 9, 0, 8.5, 10, 6).build());
  // Paint in chunks of CHUNK splats, each its own mesh: a new splat only
  // rebuilds the newest chunk; the oldest chunk goes when there are too many.
  const chunks = []; // { mesh, splats, dirty }
  const particles = createParticles3D(700, { reducedMotion });
  const m = create();
  // The camera: eye position (render space: x, height, game y), view angle and pitch.
  const cam = { x: W / 2, y: 120, z: H / 2, yaw: 0, pitch: 0, bob: 0 };
  let splatsDirty = false;
  const balls = Array.from({ length: MAX_BALLS }, () => ({ on: false, x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0, t: 0, dur: 0, color: null, splat: false, nx: 0, ny: 0, nz: 0, bend: 0 }));
  let time = 0;
  let kick = 0;

  function rebuildSplats() {
    for (const c of chunks) {
      if (!c.dirty) continue;
      const b = new MeshBuilder();
      for (const sp of c.splats) addSplat(b, sp, glow);
      r.update(c.mesh, b.build());
      c.dirty = false;
    }
    splatsDirty = false;
  }

  // sp: { x, y, z, nx, nz, r, color, floor, ceiling, bend } in render space (y = height)
  function splat(sp) {
    sp.seed = Math.floor(Math.random() * 1e9);
    let c = chunks[chunks.length - 1];
    if (!c || c.splats.length >= CHUNK) {
      c = { mesh: r.mesh(new Float32Array(0)), splats: [], dirty: false };
      chunks.push(c);
      if (chunks.length > MAX_CHUNKS) r.free(chunks.shift().mesh);
    }
    c.splats.push(sp);
    c.dirty = true;
    splatsDirty = true;
  }

  return {
    r,
    particles,

    update(dt) {
      time += dt;
      kick = Math.max(0, kick - dt * 9);
      particles.update(dt);
      for (const bl of balls) {
        if (!bl.on) continue;
        bl.t += dt;
        if (bl.t < bl.dur) continue;
        bl.on = false;
        const col = rgb(bl.color);
        particles.burst(bl.x1, bl.z1, bl.y1, col, reducedMotion ? 4 : 9, { speed: 22, life: 0.45, size: 1.1, gravity: -60, up: 0.3 });
        if (!bl.splat) continue;
        const size = 1.7 + Math.random() * 1.3;
        if (bl.nz > 0.5) splat({ x: bl.x1, y: bl.z1, z: bl.y1, nx: 0, nz: 0, r: size, color: bl.color, floor: true });
        else if (bl.nz < -0.5) splat({ x: bl.x1, y: bl.z1, z: bl.y1, nx: 0, nz: 0, r: size, color: bl.color, floor: true, ceiling: true });
        else splat({ x: bl.x1, y: bl.z1, z: bl.y1, nx: bl.nx, nz: bl.ny, r: size, color: bl.color, floor: false, bend: bl.bend });
      }
    },

    // A flying paint ball fired from the eye at (x0, y0, z0) looking along
    // (yaw, pitch); it leaves from the marker and lands at (x1, y1, z1).
    // paint: leave paint there on the surface with normal hit.nx/ny/nz
    // (bend = radius of a round solid, 0 = flat).
    ball(x0, y0, z0, yaw, pitch, x1, y1, z1, color, paint, hit, bend = 0) {
      const bl = balls.find((q) => !q.on) ?? balls[0];
      // From the marker: a bit forward, to the right and down from the eye.
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const sx = x0 + c * cp * 4 - sn * 1.6;
      const sy = y0 + sn * cp * 4 + c * 1.6;
      const sz = z0 + sp * 4 - 2.2;
      Object.assign(bl, {
        on: true, x0: sx, y0: sy, z0: sz, x1, y1, z1, t: 0, dur: Math.hypot(x1 - sx, y1 - sy, z1 - sz) / BALL_SPEED,
        color, splat: paint, nx: hit.nx, ny: hit.ny, nz: hit.nz, bend,
      });
    },

    // Paint on a player that got hit (feet at height z) and on the floor
    // below (at height floor: also when the player was in the air).
    paintHit(x, y, z, floor, color, big) {
      particles.burst(x, z + 11, y, rgb(color), reducedMotion ? 6 : big ? 30 : 14, { speed: big ? 34 : 24, life: 0.6, size: 1.3, gravity: -70, up: 0.6 });
      const a = Math.random() * Math.PI * 2;
      const d = big ? 0 : Math.random(); // under the feet: never beside an edge they stood on
      splat({ x: x + Math.cos(a) * d, y: floor, z: y + Math.sin(a) * d, nx: 0, nz: 0, r: big ? 4.5 + Math.random() * 2 : 1.4 + Math.random(), color, floor: true });
    },

    // Armour: the ball bounces off in grey sparks.
    deflect(x, y, z) {
      particles.burst(x, z + 11, y, [0.85, 0.88, 0.92], reducedMotion ? 4 : 12, { speed: 30, life: 0.35, size: 0.9, gravity: -40, up: 0.4 });
    },

    pickup(x, y, z, color) {
      particles.burst(x, z + 6, y, rgb(color), reducedMotion ? 6 : 26, { speed: 26, life: 0.7, size: 1.2, gravity: -20, up: 1 });
    },

    // Power-up pads: the plate (lit in the colour of what lies on it) and the model above it.
    pads(list, types) {
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const t = types[i] ?? PAD_EMPTY;
        const has = t !== PAD_EMPTY && PB_POWERS[t];
        const pz = p.z ?? 0;
        compose(m, p.x, pz + 0.02, p.y);
        r.draw(pad, m, has ? rgb(PB_POWERS[t].color) : [0.45, 0.47, 0.5]);
        if (!has) continue;
        const bob = reducedMotion ? 0 : Math.sin(time * 2.4 + i) * 1.1;
        compose(m, p.x, pz + 8 + bob, p.y, time * 1.5 + i, 0, 0, 1.25);
        r.draw(models[t], m);
      }
    },

    muzzle(x, y, z, yaw, color) {
      particles.burst(x + Math.cos(yaw) * 6, z - 2, y + Math.sin(yaw) * 6, rgb(color), 3, { speed: 8, life: 0.2, size: 0.8, gravity: 0, up: 0.2 });
    },

    kick() {
      kick = 1;
    },

    // First-person camera: feet at (x, y, z), looking along yaw and pitch;
    // bob = walking bounce. dead: slowly rises above the spot where you were
    // splatted. overview: circling high over the field (spectators).
    begin({ x, y, z = 0, yaw, pitch = 0, bob = 0, dead = 0, overview = false }) {
      if (splatsDirty) rebuildSplats();
      if (overview) {
        const a = time * 0.08;
        r.camera(W / 2 + Math.cos(a) * span * 0.62, span * 0.36, H / 2 + Math.sin(a) * span * 0.48, W / 2, 0, H / 2, 0.9, 1, far);
      } else if (dead > 0) {
        // Rise over the spot (not through the ceiling when it happened indoors).
        const room = ceilingHeight(arena, x, y, 1, z + PB_PHYS.EYE) - z - PB_PHYS.EYE - 2;
        const rise = Math.min(1, dead) * Math.max(0, Math.min(45, room)) / 45;
        const back = Math.min(1, dead) * (room < 20 ? 6 : 30);
        r.camera(x - Math.cos(yaw) * back, z + PB_PHYS.EYE + 45 * rise, y - Math.sin(yaw) * back, x, z + 2, y, FOV, 0.5, far);
      } else {
        const eye = z + PB_PHYS.EYE + bob;
        const cp = Math.cos(pitch);
        r.camera(x, eye, y, x + Math.cos(yaw) * cp * 10, eye + Math.sin(pitch) * 10, y + Math.sin(yaw) * cp * 10, FOV, 0.5, far);
        cam.x = x;
        cam.y = eye;
        cam.z = y;
        cam.yaw = yaw;
        cam.pitch = pitch;
        cam.bob = bob;
      }
      if (!r.begin()) return false;
      compose(m, 0, 0, 0);
      r.draw(world, m);
      for (const c of chunks) r.draw(c.mesh, m);
      return true;
    },

    // A player: feet at (x, y, z), view angle and pitch, walk phase, colour
    // [r,g,b], paint marks (hex colours of the hits), alpha (camouflage), air
    // (jumping or falling: legs tucked up).
    player(x, y, z, yaw, pitch, walk, speed, color, marks = null, alpha = 1, air = false) {
      const ry = yawFromDir(Math.cos(yaw), Math.sin(yaw));
      const lean = Math.max(-0.35, Math.min(0.35, (pitch ?? 0) * 0.3));
      compose(m, x, z, y, ry, 0, lean);
      r.draw(body, m, color, alpha);
      if (marks && alpha === 1) marks.forEach((hex, i) => r.draw(markMeshes[i % markMeshes.length], m, rgb(hex)));
      const swing = air ? 0.5 : Math.min(1, speed / PB_PHYS.SPEED) * Math.sin(walk) * 0.55;
      compose(m, x, z + HIP, y, ry, 0, swing);
      r.draw(legL, m, color, alpha);
      compose(m, x, z + HIP, y, ry, 0, air ? swing * 0.3 : -swing);
      r.draw(legR, m, color, alpha);
    },

    shield(x, y, z, color) {
      compose(m, x, z, y, time);
      r.draw(bubble, m, color, 0.22);
    },

    // Flying balls (solid, so before anything see-through).
    balls() {
      for (const bl of balls) {
        if (!bl.on) continue;
        const k = bl.t / bl.dur;
        compose(m, bl.x0 + (bl.x1 - bl.x0) * k, bl.z0 + (bl.z1 - bl.z0) * k, bl.y0 + (bl.y1 - bl.y0) * k);
        r.draw(ball, m, rgb(bl.color));
      }
    },

    // The net (see-through) and particles: after all solid things.
    endWorld() {
      compose(m, 0, 0, 0);
      r.draw(net, m, undefined, 0.32);
      particles.draw(r, 1.2, false);
    },

    // Your own marker in front of the camera (drawn over the world), turned
    // with the view (also up and down).
    viewGun(color, reloading, camo = false) {
      r.clearDepth();
      const a = cam.yaw;
      const p = cam.pitch;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const cp = Math.cos(p);
      const sp = Math.sin(p);
      // Forward, right and up in render space (x, height, game y).
      const fw = 4.6 - kick * 0.6;
      const side = 2.1;
      const down = (reloading ? 3.6 : 2.6) - cam.bob * 0.4;
      const px = cam.x + c * cp * fw - sn * side + c * sp * down;
      const py = cam.y + sp * fw - cp * down;
      const pz = cam.z + sn * cp * fw + c * side + sn * sp * down;
      compose(m, px, py, pz, yawFromDir(c, sn), 0, p + (reloading ? -0.5 : kick * 0.12), 0.42);
      r.draw(gun, m, color, camo ? 0.4 : 1);
    },

    // World point (game x, y at height h) → HUD coordinates.
    project(x, y, h, out) {
      return r.project(x, h, y, out);
    },

    clearPaint() {
      for (const c of chunks) r.free(c.mesh);
      chunks.length = 0;
      for (const bl of balls) bl.on = false;
      particles.clear();
    },

    destroy() {
      r.destroy();
    },
  };
}

// --- Models (facing +x, feet at y = 0) ---------------------------------------------------------
function buildBody() {
  const b = new MeshBuilder();
  // Pants (tinted a little), jersey in the player's colour, vest details.
  b.color('#2d3038').box(0, 6.6, 0, 3.2, 2.2, 5.2);
  b.color('#ffffff', { tint: 1 }).box(0, 8.6, 0, 3.4, 5.4, 5.6);
  b.color('#23252b').box(0.3, 9.2, 0, 3.2, 1.2, 5.9); // harness strap
  b.color('#ffffff', { tint: 1 }).box(0.2, 13.8, -3.3, 2.2, 1.6, 1.6).box(0.2, 13.8, 3.3, 2.2, 1.6, 1.6); // shoulders
  // Arms reaching to the marker.
  b.color('#ffffff', { tint: 0.85 }).box(1.8, 11.6, -2.9, 4.4, 1.4, 1.4).box(2.2, 11.4, 2.4, 5.2, 1.4, 1.4);
  b.color('#e8b894').box(4.4, 11.4, 1.7, 1.2, 1.4, 1.4);
  // Head, mask with goggles, cap.
  b.color('#e8b894').sphere(0, 15.8, 0, 1.9, 7, 5);
  b.color('#2a2c33').box(1.3, 14.4, 0, 1.4, 2.8, 3.2);
  b.color('#8fd3ff', { emissive: 0.25 }).box(1.95, 15.6, 0, 0.3, 1.1, 3);
  b.color('#ffffff', { tint: 1 }).cylinder(0, 16.7, 0, 2.05, 1.1, 8);
  b.color('#ffffff', { tint: 0.7 }).box(1.9, 16.8, 0, 1.6, 0.3, 3); // cap brim
  // The marker with its hopper.
  b.color('#3a3d45').box(5.4, 12.2, 1.2, 5.2, 1.3, 1.1);
  b.color('#3a3d45').box(8.8, 12.5, 1.2, 3.2, 0.6, 0.6);
  b.color('#ffffff', { tint: 1 }).sphere(4.6, 14.2, 1.2, 1.3, 6, 4);
  return b.build();
}

// A leg hanging from the hip (origin at the hip), shoe at the bottom.
function buildLeg(z) {
  const b = new MeshBuilder();
  b.color('#2d3038').box(0, -HIP + 1.4, z, 1.8, HIP - 1.4, 1.9);
  b.color('#1b1c20').box(0.5, -HIP, z, 2.8, 1.4, 2);
  return b.build();
}

// First-person marker (seen from behind, slightly to the right).
function buildViewGun() {
  const b = new MeshBuilder();
  b.color('#34373f').box(0, 0, 0, 7, 1.5, 1.3);
  b.color('#23252b').box(4.6, 0.35, 0, 4, 0.75, 0.75);
  b.color('#23252b').box(-1.4, -2.2, 0, 1.1, 2.4, 0.9); // grip
  b.color('#ffffff', { tint: 1 }).sphere(-0.6, 2.2, 0, 1.15, 7, 5); // hopper
  b.color('#ffffff', { tint: 1 }).box(-0.6, 1.3, 0, 0.8, 0.8, 0.8);
  b.color('#e8b894').box(-1.6, -1.2, 0.2, 1.8, 1.8, 1.4); // hand
  return b.build();
}

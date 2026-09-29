// Hapvis: shared values and movement. Fish swim towards the stick (bigger =
// slower), a dash costs a little mass. Movement is deterministic (only
// + - * / Math.sqrt, float32 via Math.fround) so the owner can predict it;
// eating and plankton are decided by the server.
import { createRng } from '../rng.js';

export const FISH = {
  DT: 1 / 30,
  WIDTH: 1200,
  HEIGHT: 800,
  START_MASS: 10,
  ACCEL: 260,
  DASH_FACTOR: 2.1, // top speed multiplier while dashing
  DASH_S: 0.35,
  DASH_COOLDOWN_S: 1.6,
  DASH_COST: 0.04, // part of the mass a dash costs (at least 1)
  EAT_RATIO: 1.25, // you can eat fish this much smaller (in mass)
  EAT_GAIN: 0.8, // part of the eaten mass you get
  PLANKTON: 256, // food slots
  PLANKTON_MASS: 1,
  PLANKTON_R: 2.6,
  PLANKTON_RESPAWN_S: [6, 14],
  RESPAWN_S: 2.5,
  DECAY: 0.002, // mass lost per second above DECAY_FROM (keeps giants moving)
  DECAY_FROM: 120,
  BOOST_FACTOR: 1.45, // top speed multiplier with the turbo power-up
};

export const FISH_FLAG = { BOT: 1, CONNECTED: 2, ALIVE: 4, DASH: 8 };

// Power-ups (the setting 'powerups'): bubbles that drift in the sea. The id is
// the index and the wire value. Timed effects last `seconds`.
export const FISH_POWER = { TURBO: 0, SPIKES: 1, MAGNET: 2, DOUBLE: 3, GROW: 4 };
export const FISH_POWERS = [
  { id: 'turbo', name: 'Turbo', color: '#ffe14d', seconds: 6, weight: 1 },
  { id: 'spikes', name: 'Stekels', color: '#c38bff', seconds: 8, weight: 0.8 },
  { id: 'magnet', name: 'Magneet', color: '#ff6b6b', seconds: 10, weight: 1 },
  { id: 'double', name: 'Dubbel', color: '#7df0a0', seconds: 10, weight: 0.9 },
  { id: 'grow', name: 'Groeien', color: '#ffa94d', seconds: 0, weight: 0.8 },
];
export const FISH_POWER_RULES = {
  MAX: 3, // bubbles in the sea at once
  EVERY_S: [5, 8], // time between two new bubbles
  LIFE_S: 16,
  RADIUS: 9,
  MAGNET_RANGE: 60, // extra reach for plankton
  SPIKE_LOSS: 0.15, // part of the mass a fish loses when it bites a spiky one
  SPIKE_PUSH: 220, // speed it gets pushed back with
  GROW: 8, // mass (and points) from the grow bubble
};

const f = Math.fround;

export const fishRadius = (mass) => 5 + Math.sqrt(mass) * 1.4;
export const fishSpeed = (mass) => 40 + (70 * 20) / (20 + mass * 0.12);

export function createFish(x = 0, y = 0, mass = FISH.START_MASS) {
  return { x, y, vx: 0, vy: 0, mass, dash: 0, cool: 0, prevA: 0, fx: 1, fy: 0, boost: 0 };
}

// One tick: steer towards the stick, dash on a fresh press of A. The turbo
// power-up (boost timer) is part of the predicted state.
export function stepFish(s, ax, ay, a, dt) {
  const P = FISH;
  const mag = Math.sqrt(ax * ax + ay * ay);
  let tx = 0;
  let ty = 0;
  if (mag > 0.12) {
    const k = mag > 1 ? 1 / mag : 1;
    tx = ax * k;
    ty = ay * k;
    s.fx = f(ax / mag);
    s.fy = f(ay / mag);
  }
  if (s.cool > 0) s.cool = f(s.cool - dt > 0 ? s.cool - dt : 0);
  if (s.dash > 0) s.dash = f(s.dash - dt > 0 ? s.dash - dt : 0);
  if (s.boost > 0) s.boost = f(s.boost - dt > 0 ? s.boost - dt : 0);
  if (a && !s.prevA && s.cool <= 0 && s.mass > P.START_MASS + 1) {
    s.dash = f(P.DASH_S);
    s.cool = f(P.DASH_COOLDOWN_S);
    const cost = s.mass * P.DASH_COST;
    s.mass = f(s.mass - (cost > 1 ? cost : 1));
  }
  s.prevA = a ? 1 : 0;
  const top = fishSpeed(s.mass) * (s.dash > 0 ? P.DASH_FACTOR : 1) * (s.boost > 0 ? P.BOOST_FACTOR : 1);
  const wantX = tx * top;
  const wantY = ty * top;
  let dvx = wantX - s.vx;
  let dvy = wantY - s.vy;
  const dl = Math.sqrt(dvx * dvx + dvy * dvy);
  const max = P.ACCEL * (s.dash > 0 ? 3 : 1) * dt;
  if (dl > max) {
    dvx = (dvx / dl) * max;
    dvy = (dvy / dl) * max;
  }
  s.vx = f(s.vx + dvx);
  s.vy = f(s.vy + dvy);
  const r = fishRadius(s.mass);
  let x = s.x + s.vx * dt;
  let y = s.y + s.vy * dt;
  if (x < r) { x = r; s.vx = 0; }
  if (x > P.WIDTH - r) { x = P.WIDTH - r; s.vx = 0; }
  if (y < r) { y = r; s.vy = 0; }
  if (y > P.HEIGHT - r) { y = P.HEIGHT - r; s.vy = 0; }
  s.x = f(x);
  s.y = f(y);
}

// Plankton slots: fixed spots from the match seed (client and server agree).
export function planktonSpots(seed) {
  const rng = createRng(seed);
  const xs = new Float32Array(FISH.PLANKTON);
  const ys = new Float32Array(FISH.PLANKTON);
  for (let i = 0; i < FISH.PLANKTON; i++) {
    xs[i] = 16 + rng() * (FISH.WIDTH - 32);
    ys[i] = 16 + rng() * (FISH.HEIGHT - 32);
  }
  return { xs, ys };
}

export const canEat = (big, small) => big.mass >= small.mass * FISH.EAT_RATIO;

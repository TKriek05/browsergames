// Spetterveld bots: walk over the navigation graph (paintball-nav.js: floors,
// stairs, crates to jump onto), strafe while they have a clear shot, turn
// their view (and look up or down) at a limited speed and only fire when the
// target is close to the crosshair. Easy bots aim sloppily and react slowly;
// hard bots are quick and precise. Without a target in sight they fetch a
// power-up from a pad nearby, and a camouflaged player is only noticed up close.
import { PB_PHYS, PB_STANCE, lineOfSight, eyeHeight, bodyHeight } from '../../shared/physics/paintball.js';
import { BTN } from '../../shared/messages.js';
import { PB_RULES as R, PB_POWER_RULES as PR, wrapAngle } from '../../shared/games/paintball.js';
import { PAD_EMPTY } from './paintball-powers.js';
import { navFor, nodeAt, nodeX, nodeY, distancesTo, nextNode } from './paintball-nav.js';

const PAD_REACH = 170; // bots walk this far for a power-up
const CHEST = 0.6; // bots aim at this part of a body's height (the chest)
const FIELD_CACHE = 48; // distance fields kept per level (the level never changes, so they stay valid)
const STUCK_S = 1.2;

// lagMs: bots see where you were this long ago (like a human's reaction),
// so strafing makes you harder to hit.
const LEVELS = {
  easy: { think: 0.6, jitter: 0.17, turn: 2.8, reaction: 0.85, cone: 0.2, keep: 90, speed: 0.72, strafe: 0.35, pause: 0.55, lagMs: 260 },
  normal: { think: 0.35, jitter: 0.085, turn: 4.4, reaction: 0.45, cone: 0.12, keep: 110, speed: 0.9, strafe: 0.7, pause: 0.18, lagMs: 180 },
  hard: { think: 0.22, jitter: 0.045, turn: 6.5, reaction: 0.26, cone: 0.08, keep: 130, speed: 1, strafe: 1, pause: 0.04, lagMs: 120 },
};

const fields = new Map(); // level key → Map(goal node → Int16Array distances)
function fieldTo(level, nav, goal) {
  let m = fields.get(level.key);
  if (!m) fields.set(level.key, (m = new Map()));
  let d = m.get(goal);
  if (d) {
    m.delete(goal); // most recently used last
    m.set(goal, d);
    return d;
  }
  d = distancesTo(nav, goal, new Int16Array(nav.count));
  m.set(goal, d);
  if (m.size > FIELD_CACHE) m.delete(m.keys().next().value);
  return d;
}

export function createPaintBot() {
  return {
    think: 0, target: null, visible: false, seen: 0, jitter: 0, pause: 0,
    strafe: 1, strafeT: 0, goal: -1, goalX: 0, goalY: 0, dist: null,
    lastX: 0, lastY: 0, lastZ: 0, still: 0, unstick: 0,
    out: { ax: 0, ay: 0, jump: false, buttons: 0, yaw: 0, pitch: 0, fire: false, reload: false },
  };
}

const eye = (e) => e.s.z + eyeHeight(e.s.stance);
const chest = (o) => o.s.z + bodyHeight(o.s.stance) * CHEST;

function sees(game, e, o) {
  return lineOfSight(game.level, e.s.x, e.s.y, eye(e), o.s.x, o.s.y, chest(o));
}

function pickTarget(e, game) {
  let best = null;
  let bestScore = Infinity;
  for (const o of game.ents) {
    if (o === e || !o.alive) continue;
    const d = Math.hypot(o.s.x - e.s.x, o.s.y - e.s.y, o.s.z - e.s.z);
    if (o.camo > 0 && d > PR.CAMO_SIGHT) continue;
    const score = d * (sees(game, e, o) ? 1 : 1.8) * (o.shield > 0 ? 2 : 1);
    if (score < bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}

function nearestPad(e, game) {
  let best = null;
  let bestD = PAD_REACH;
  for (const pad of game.powers?.pads ?? []) {
    if (pad.type === PAD_EMPTY) continue;
    const d = Math.hypot(pad.x - e.s.x, pad.y - e.s.y, (pad.z - e.s.z) * 2);
    if (d < bestD) {
      bestD = d;
      best = pad;
    }
  }
  return best;
}

export const pickTargetForTest = pickTarget;

const seen = { x: 0, y: 0, z: 0 };

// Where to walk: the node two links ahead on the way to the goal (or the
// goal itself when we are there). Sets move.x/y (unit), move.up (the next
// node is higher than a step: jump).
const move = { x: 0, y: 0, up: false, ok: false };
function followNav(b, s, nav) {
  move.ok = false;
  move.up = false;
  if (!b.dist) return move;
  const cur = nodeAt(nav, s.x, s.y, s.z);
  if (cur < 0) return move;
  const n1 = nextNode(nav, cur, b.dist);
  let tx;
  let ty;
  if (n1 < 0) {
    if (b.dist[cur] !== 0) return move; // cut off from the goal
    tx = b.goalX;
    ty = b.goalY;
  } else {
    const n2 = nextNode(nav, n1, b.dist);
    const h1 = nav.height[n1];
    move.up = h1 > s.z + PB_PHYS.STEP - 0.1;
    // Look two links ahead on flat ground; aim at the very next node before a jump or a drop.
    const far = n2 >= 0 && !move.up && Math.abs(nav.height[n2] - h1) <= PB_PHYS.STEP && Math.abs(h1 - s.z) <= PB_PHYS.STEP;
    const k = far ? n2 : n1;
    tx = nodeX(nav, k);
    ty = nodeY(nav, k);
    if (move.up && Math.hypot(nodeX(nav, n1) - s.x, nodeY(nav, n1) - s.y) > 9) move.up = false; // not at the edge yet
  }
  const dx = tx - s.x;
  const dy = ty - s.y;
  const l = Math.hypot(dx, dy);
  if (l < 0.5) return move;
  move.x = dx / l;
  move.y = dy / l;
  move.ok = true;
  return move;
}

export function stepPaintBot(e, game, dt, rng) {
  const cfg = LEVELS[e.player.botLevel] ?? LEVELS.normal;
  const b = e.bot;
  const out = b.out;
  const s = e.s;
  const level = game.level;
  const nav = navFor(level);
  out.fire = false;
  out.reload = false;
  out.jump = false;
  b.think -= dt;
  b.strafeT -= dt;
  b.pause -= dt;
  b.unstick -= dt;

  if (b.think <= 0) {
    b.think = cfg.think * (0.8 + rng() * 0.4);
    b.jitter = (rng() - 0.5) * 2 * cfg.jitter;
    b.target = pickTarget(e, game);
    const pad = b.target && sees(game, e, b.target) ? null : nearestPad(e, game);
    let goal;
    if (pad) goal = nodeAt(nav, pad.x, pad.y, pad.z);
    else if (b.target) goal = nodeAt(nav, b.target.s.x, b.target.s.y, b.target.s.z);
    else goal = b.goal >= 0 && rng() < 0.7 ? b.goal : Math.floor(rng() * nav.count); // roam
    if (goal < 0) goal = Math.floor(rng() * nav.count);
    b.goal = goal;
    b.goalX = pad ? pad.x : b.target ? b.target.s.x : nodeX(nav, goal);
    b.goalY = pad ? pad.y : b.target ? b.target.s.y : nodeY(nav, goal);
    b.dist = fieldTo(level, nav, goal);
  }
  if (b.strafeT <= 0) {
    b.strafe = rng() < 0.5 ? -1 : 1;
    b.strafeT = 0.6 + rng() * 1.2;
  }

  const t = b.target && b.target.alive ? b.target : null;
  b.visible = !!t && sees(game, e, t);
  let mx = 0;
  let my = 0;
  if (t && b.visible) {
    const dx = t.s.x - s.x;
    const dy = t.s.y - s.y;
    const d = Math.hypot(dx, dy) || 1;
    const fx = dx / d;
    const fy = dy / d;
    const approach = d > cfg.keep + 25 ? 1 : d < cfg.keep - 35 ? -0.7 : 0;
    const strafe = cfg.strafe * (s.z > 1 ? 0.5 : 1); // careful up high
    mx = fx * approach - fy * b.strafe * strafe;
    my = fy * approach + fx * b.strafe * strafe;
    b.seen += dt;
  } else {
    b.seen = 0;
    const m = followNav(b, s, nav);
    if (m.ok) {
      mx = m.x;
      my = m.y;
      if (m.up && s.ground) out.jump = true;
    }
  }
  // Stuck against something? Jump and slide sideways for a moment.
  const moved = Math.hypot(s.x - b.lastX, s.y - b.lastY, s.z - b.lastZ);
  if (moved > 3 || (mx === 0 && my === 0)) {
    b.still = 0;
    b.lastX = s.x;
    b.lastY = s.y;
    b.lastZ = s.z;
  } else if ((b.still += dt) > STUCK_S) {
    b.still = 0;
    b.unstick = 0.5;
    b.strafe = -b.strafe;
  }
  if (b.unstick > 0) {
    const ux = mx - my * b.strafe;
    const uy = my + mx * b.strafe;
    mx = ux;
    my = uy;
    if (s.ground) out.jump = true;
  }
  const ml = Math.hypot(mx, my);
  out.ax = ml > 0 ? (mx / ml) * cfg.speed : 0;
  out.ay = ml > 0 ? (my / ml) * cfg.speed : 0;

  // Turn the view at a limited speed (towards where the target was a moment
  // ago); fire when the crosshair is close enough.
  let want = ml > 0 ? Math.atan2(my, mx) : e.yaw;
  let wantPitch = 0;
  if (t && b.visible) {
    const p = game.history.positionAt(t.player.slot, game.room.now() - cfg.lagMs, seen) ? seen : t.s;
    want = Math.atan2(p.y - s.y, p.x - s.x) + b.jitter;
    wantPitch = Math.atan2(p.z + bodyHeight(t.s.stance) * CHEST - eye(e), Math.hypot(p.x - s.x, p.y - s.y)) + b.jitter * 0.5;
  }
  const maxTurn = cfg.turn * dt;
  const diff = wrapAngle(want - e.yaw);
  out.yaw = wrapAngle(e.yaw + (diff > maxTurn ? maxTurn : diff < -maxTurn ? -maxTurn : diff));
  const dp = wantPitch - e.pitch;
  out.pitch = Math.max(-R.MAX_PITCH, Math.min(R.MAX_PITCH, e.pitch + (dp > maxTurn ? maxTurn : dp < -maxTurn ? -maxTurn : dp)));
  if (t && b.visible && b.seen >= cfg.reaction && b.pause <= 0 && e.ammo > 0 && e.reload <= 0
    && Math.abs(wrapAngle(want - out.yaw)) < cfg.cone && Math.abs(wantPitch - out.pitch) < cfg.cone) {
    out.fire = true;
    b.pause = cfg.pause * (0.5 + rng());
    b.jitter = Math.max(-cfg.jitter, Math.min(cfg.jitter, b.jitter + (rng() - 0.5) * cfg.jitter));
  }
  if (!b.visible && e.reload <= 0 && e.ammo < R.HOPPER / 2) out.reload = true;
  // Duck while reloading (stand up to jump); a toggle button is pressed only
  // while the stance is not yet the one we want.
  const stance = e.reload > 0 && !out.jump ? PB_STANCE.CROUCH : PB_STANCE.STAND;
  out.buttons = out.jump ? BTN.X : 0;
  const toggle = s.stance === PB_STANCE.PRONE ? BTN.L : BTN.R; // the direct crouch / lie toggles
  if (s.stance !== stance && s.ground && !(s.prev & toggle)) out.buttons |= toggle; // press, release, press …
  return out;
}

// Tests: walk to (x, y, z) from now on (no target, no new plans).
export function goToForTest(e, game, x, y, z) {
  const b = e.bot;
  const nav = navFor(game.level);
  b.think = 1e9;
  b.target = null;
  b.goal = nodeAt(nav, x, y, z);
  b.goalX = x;
  b.goalY = y;
  b.dist = fieldTo(game.level, nav, b.goal);
}

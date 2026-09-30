// Turbo Kart GP bots: aim at a point further along the track (with their
// own lane offset), lift off before sharp corners, drift through long bends
// (hard bots) and use items sensibly. They drive with the same stick and
// button input as humans, through the same physics. Where there is no
// barrier they keep to the middle, and they do a trick on every jump.
import { BTN } from '../../shared/messages.js';
import { pointAt, trackQuery, createTrackQuery } from '../../shared/maps/kart-tracks.js';
import { KART_PHYS } from '../../shared/physics/kart.js';
import { ITEM } from '../../shared/games/kartrace.js';

const LEVELS = {
  easy: { speed: 0.8, look: 50, corner: 0.8, drift: false, itemDelay: 2.5, wobble: 0.25 },
  normal: { speed: 0.91, look: 62, corner: 0.9, drift: false, itemDelay: 1.2, wobble: 0.1 },
  hard: { speed: 1, look: 72, corner: 1, drift: true, itemDelay: 0.5, wobble: 0.03 },
};

export function createKartBot() {
  return {
    q: createTrackQuery(),
    out: { ax: 0, ay: 0, buttons: 0 },
    lane: 0, laneT: 0, itemT: 0, stuckT: 0, reverseT: 0, wobble: 0, wobbleT: 0, drifting: 0,
  };
}

// Heading change (radians, signed) of the track between two distances.
function bend(track, d0, d1) {
  const a = pointAt(track, d0);
  const b = pointAt(track, d1);
  return Math.atan2(a.tx * b.ty - a.ty * b.tx, a.tx * b.tx + a.ty * b.ty);
}

export function stepKartBot(k, game, dt, rng) {
  const cfg = LEVELS[k.player.botLevel] ?? LEVELS.normal;
  const b = k.bot;
  const s = k.s;
  const track = game.track;
  const out = b.out;
  out.ax = 0;
  out.ay = 0;
  out.buttons = 0;

  trackQuery(track, s.x, s.y, b.q, s.seg);
  b.laneT -= dt;
  if (b.laneT <= 0) {
    b.laneT = 2 + rng() * 3;
    b.lane = (rng() - 0.5) * 0.8; // a fraction of the half width
  }
  if (s.fall > 0) return out;
  // In the air: a trick (tap drift once), steer along the road.
  if (s.z > 0 || s.vz > 0) {
    if (!s.trick && !(s.prev & BTN.B)) out.buttons |= BTN.B;
    out.buttons |= BTN.A;
  }
  b.wobbleT -= dt;
  if (b.wobbleT <= 0) {
    b.wobbleT = 0.4 + rng() * 0.6;
    b.wobble = (rng() - 0.5) * 2 * cfg.wobble;
  }

  // Stuck against a barrier or turned around: back up for a moment.
  if (b.reverseT > 0) {
    b.reverseT -= dt;
    out.ay = 1;
    out.ax = b.q.lateral > 0 ? 1 : -1;
    return out;
  }
  const forwardDot = s.hx * track.tx[b.q.seg] + s.hy * track.ty[b.q.seg];
  if ((Math.abs(s.v) < 8 || forwardDot < -0.2) && s.spin <= 0) b.stuckT += dt;
  else b.stuckT = 0;
  if (b.stuckT > 1.2) {
    b.stuckT = 0;
    b.reverseT = 0.7;
  }

  // Steer towards a point ahead on our lane; tighter lane in sharp corners.
  const look = cfg.look + Math.max(0, s.v) * 0.3;
  const curve = bend(track, b.q.dist, b.q.dist + 140);
  const p = pointAt(track, b.q.dist + look);
  // Keep to the middle where there is no barrier (or a jump is coming).
  const risky = track.wl[p.seg] < 0 || track.wr[p.seg] < 0 || nearRamp(track, b.q.dist, 260);
  const lane = b.lane * p.half * Math.max(0, 1 - Math.abs(curve)) * (risky ? 0.15 : 1);
  const tx = p.x - p.ty * lane;
  const ty = p.y + p.tx * lane;
  const dx = tx - s.x;
  const dy = ty - s.y;
  const lx = dx * -s.hy + dy * s.hx; // right of us
  const fx = dx * s.hx + dy * s.hy;
  const angle = Math.atan2(lx, fx);
  out.ax = Math.max(-1, Math.min(1, angle * 2.4 + b.wobble));

  // Throttle: slow down before sharp bends.
  const cornerSpeed = KART_PHYS.MAX_SPEED * cfg.speed * cfg.corner * (1 - Math.min(0.55, Math.abs(curve) * 0.45));
  // Full speed before a jump (you need it to clear a gap).
  const target = nearRamp(track, b.q.dist, 400) ? KART_PHYS.MAX_SPEED : Math.min(KART_PHYS.MAX_SPEED * cfg.speed, cornerSpeed);
  if (s.v < target || s.boost > 0) out.buttons |= BTN.A;
  else if (s.v > target + 30) out.ay = 1;

  // Hard bots drift through long bends for mini turbos.
  if (cfg.drift && !(s.z > 0 || s.vz > 0)) {
    const longBend = Math.abs(curve) > 0.7 && s.v > KART_PHYS.DRIFT_MIN_SPEED;
    if (longBend || (b.drifting && Math.abs(curve) > 0.25 && s.drift !== 0)) {
      out.buttons |= BTN.B;
      b.drifting = 1;
      if (s.drift === 0) out.ax = curve > 0 ? 1 : -1;
    } else b.drifting = 0;
  }

  // Items
  if (s.item) {
    b.itemT += dt;
    if (b.itemT >= cfg.itemDelay && useItemNow(k, game, curve)) {
      out.buttons |= BTN.X;
      b.itemT = 0;
    }
  } else b.itemT = 0;
  return out;
}

// A ramp within `ahead` units in front of distance d.
function nearRamp(track, d, ahead) {
  for (const r of track.ramps) {
    const along = (track.cum[r.seg] - d + track.length) % track.length;
    if (along < ahead) return true;
  }
  return false;
}

function useItemNow(k, game, curve) {
  const s = k.s;
  switch (s.item) {
    case ITEM.TURBO:
    case ITEM.TURBO2:
    case ITEM.TURBO3:
    case ITEM.STAR:
      return Math.abs(curve) < 0.3; // on a straight
    case ITEM.SHIELD:
    case ITEM.LIGHTNING:
      return true;
    case ITEM.ROCKET:
      return k.place > 1 || k.bot.itemT > 8; // it needs somebody ahead to chase
    case ITEM.OIL:
    case ITEM.ORB:
    case ITEM.BOMB: {
      for (const o of game.karts) {
        if (o === k) continue;
        const dx = o.s.x - s.x;
        const dy = o.s.y - s.y;
        const d = Math.hypot(dx, dy);
        const ahead = (dx * s.hx + dy * s.hy) / (d || 1);
        if (s.item === ITEM.ORB && d > 20 && d < 200 && ahead > 0.92) return true;
        if (s.item === ITEM.BOMB && d > 80 && d < 200 && ahead > 0.85) return true;
        if (s.item === ITEM.OIL && d < 90 && ahead < -0.7) return true;
      }
      return k.bot.itemT > 8; // don't hoard forever
    }
    default:
      return true;
  }
}

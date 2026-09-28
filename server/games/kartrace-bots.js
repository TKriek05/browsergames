// Neon Kart GP bots: aim at a point further along the track (with their
// own lane offset), lift off before sharp corners, drift through long bends
// (hard bots) and use items sensibly. They drive with the same stick and
// button input as humans, through the same physics.
import { BTN } from '../../shared/messages.js';
import { pointAt, trackQuery } from '../../shared/maps/kart-tracks.js';
import { KART_PHYS } from '../../shared/physics/kart.js';
import { ITEM } from '../../shared/games/kartrace.js';

const LEVELS = {
  easy: { speed: 0.8, look: 50, corner: 0.8, drift: false, itemDelay: 2.5, wobble: 0.25 },
  normal: { speed: 0.91, look: 62, corner: 0.9, drift: false, itemDelay: 1.2, wobble: 0.1 },
  hard: { speed: 1, look: 72, corner: 1, drift: true, itemDelay: 0.5, wobble: 0.03 },
};

export function createKartBot() {
  return {
    q: { seg: 0, dist: 0, lateral: 0, nx: 0, ny: 0 },
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

  trackQuery(track, s.x, s.y, b.q);
  b.laneT -= dt;
  if (b.laneT <= 0) {
    b.laneT = 2 + rng() * 3;
    b.lane = (rng() - 0.5) * track.half * 0.8;
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
  const lane = b.lane * Math.max(0, 1 - Math.abs(curve));
  const p = pointAt(track, b.q.dist + look);
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
  const target = Math.min(KART_PHYS.MAX_SPEED * cfg.speed, cornerSpeed);
  if (s.v < target || s.boost > 0) out.buttons |= BTN.A;
  else if (s.v > target + 30) out.ay = 1;

  // Hard bots drift through long bends for mini turbos.
  if (cfg.drift) {
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

function useItemNow(k, game, curve) {
  const s = k.s;
  switch (s.item) {
    case ITEM.TURBO: return Math.abs(curve) < 0.3;
    case ITEM.SHIELD: return true;
    case ITEM.OIL:
    case ITEM.ORB: {
      for (const o of game.karts) {
        if (o === k) continue;
        const dx = o.s.x - s.x;
        const dy = o.s.y - s.y;
        const d = Math.hypot(dx, dy);
        const ahead = (dx * s.hx + dy * s.hy) / (d || 1);
        if (s.item === ITEM.ORB && d > 20 && d < 200 && ahead > 0.92) return true;
        if (s.item === ITEM.OIL && d < 90 && ahead < -0.7) return true;
      }
      return k.bot.itemT > 8; // don't hoard forever
    }
    default: return true;
  }
}

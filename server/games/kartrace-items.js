// Turbo Kart GP items on the server: item boxes, the roll (better items for
// the karts at the back), and what each item does. Objects on the track
// (orbs, oil, rockets, bombs) are tested against the whole path a kart drove
// this tick, so a fast kart (or one that sent several inputs at once) can not
// jump over an oil slick.
import { KART_PHYS } from '../../shared/physics/kart.js';
import { trackQuery, createTrackQuery, pointAt, FALL_EDGE } from '../../shared/maps/kart-tracks.js';
import { KART_RULES as R, ITEM } from '../../shared/games/kartrace.js';

const MAX_OBJECTS = 40;
const ORB_GRACE_S = 0.4; // your own orb/rocket can not hit you right after launch
const ROCKET_LOOK = 70; // a rocket aims at the track this far ahead until the target is close
const ROCKET_LOCK = 120; // … then flies straight at it
const REACH_UP = 12; // a kart this far above an object (a jump, a bridge) is not hit by it
const BOX_REACH = 24; // item boxes float a bit above the road: reachable in a small jump, not from another level

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Distance² from (px, py) to the segment a → b.
function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 1e-9 ? clamp01(((px - ax) * dx + (py - ay) * dy) / len2) : 0;
  const ex = ax + dx * t - px;
  const ey = ay + dy * t - py;
  return ex * ex + ey * ey;
}

export class KartItems {
  constructor(game) {
    this.game = game;
    this.objects = []; // { id, type, owner, x, y, vx, vy, age, seg, h, armed?, target? }
    this.nextId = 1;
    this.boxes = new Float32Array(0); // respawn timers per box, 0 = ready
    this.q = createTrackQuery();
  }

  reset(track) {
    this.boxes = new Float32Array(track.boxes.length);
    this.objects.length = 0;
  }

  tick(dt) {
    this._boxes(dt);
    this._objects(dt);
  }

  get room() {
    return this.game.room;
  }

  // --- Boxes ------------------------------------------------------------------------------
  _boxes(dt) {
    const boxes = this.game.track.boxes;
    for (let i = 0; i < boxes.length; i++) {
      if (this.boxes[i] > 0) {
        this.boxes[i] = Math.max(0, this.boxes[i] - dt);
        continue;
      }
      const reach = R.BOX_RADIUS + KART_PHYS.RADIUS;
      for (const k of this.game.karts) {
        if (k.finished || segDist2(boxes[i].x, boxes[i].y, k.px, k.py, k.s.x, k.s.y) > reach * reach) continue;
        if (Math.abs(this._alt(k) - this.game.track.pz[boxes[i].seg]) > BOX_REACH) continue; // another level
        this.boxes[i] = R.BOX_RESPAWN_S;
        if (k.s.item === ITEM.NONE) {
          k.s.item = this.roll(k);
          this.room.emit('item', { s: k.player.slot, item: k.s.item });
        }
        this.room.emit('box', { i });
        break;
      }
    }
  }

  // Better items for the karts at the back: the leader never gets a rocket,
  // lightning or a superstar.
  roll(k) {
    const n = Math.max(1, this.game.karts.length - 1);
    const back = (k.place - 1) / n; // 0 = leading, 1 = last
    const weights = [
      [ITEM.TURBO, 0.2 + back * 0.25],
      [ITEM.TURBO3, 0.02 + back * 0.22],
      [ITEM.ORB, 0.3],
      [ITEM.OIL, 0.35 - back * 0.25],
      [ITEM.SHIELD, 0.06 + back * 0.1],
      [ITEM.BOMB, 0.12 + back * 0.08],
      [ITEM.ROCKET, back * 0.3],
      [ITEM.LIGHTNING, back > 0.6 ? back * 0.08 : 0],
      [ITEM.STAR, back * 0.12],
    ];
    const total = weights.reduce((a, [, w]) => a + w, 0);
    let roll = this.game.rng() * total;
    for (const [item, w] of weights) {
      roll -= w;
      if (roll <= 0 && w > 0) return item;
    }
    return ITEM.TURBO;
  }

  // --- Using items --------------------------------------------------------------------------
  use(k, item) {
    const s = k.s;
    switch (item) {
      case ITEM.SHIELD:
        k.shield = R.SHIELD_S;
        break;
      case ITEM.STAR:
        k.star = R.STAR_S;
        break;
      case ITEM.LIGHTNING:
        for (const o of this.game.karts) {
          if (o === k || o.finished) continue;
          if (this.protectedKart(o)) this.room.emit('block', { s: o.player.slot, x: Math.round(o.s.x), y: Math.round(o.s.y) });
          else this.spin(o, k, R.LIGHTNING_SPIN_S, ITEM.LIGHTNING, o.s.x, o.s.y);
        }
        this.room.emit('zap', { s: k.player.slot });
        break;
      case ITEM.ORB:
      case ITEM.OIL:
      case ITEM.ROCKET:
      case ITEM.BOMB:
        this.launch(k, item);
        break;
      default:
        break;
    }
    this.room.emit('use', { s: k.player.slot, item });
  }

  launch(k, type) {
    if (this.objects.length >= MAX_OBJECTS) return;
    const s = k.s;
    const forward = type !== ITEM.OIL;
    const ahead = forward ? KART_PHYS.RADIUS + 8 : -(KART_PHYS.RADIUS + 9);
    const base = type === ITEM.ORB ? R.ORB_SPEED : type === ITEM.ROCKET ? R.ROCKET_SPEED : type === ITEM.BOMB ? R.BOMB_SPEED : 0;
    const speed = forward ? base + Math.max(0, s.v) * 0.5 : 0;
    const o = {
      id: this.nextId, type, owner: k,
      x: s.x + s.hx * ahead, y: s.y + s.hy * ahead,
      vx: s.hx * speed, vy: s.hy * speed, age: 0, seg: s.seg, h: 0,
      armed: type !== ITEM.OIL, // oil: not for its owner until they are clear of it
      target: type === ITEM.ROCKET ? this.game.karts.find((o2) => o2.place === k.place - 1 && !o2.finished) ?? null : null,
    };
    this.nextId = (this.nextId % 65535) + 1;
    this._where(o);
    this.objects.push(o);
  }

  // Where an object is on the track (its segment and the road height there).
  _where(o) {
    trackQuery(this.game.track, o.x, o.y, this.q, o.seg);
    o.seg = this.q.seg;
    o.h = this.q.h;
    return this.q;
  }

  // Absolute height of a kart (road + jump).
  _alt(k) {
    return trackQuery(this.game.track, k.s.x, k.s.y, this.q, k.s.seg).h + k.s.z;
  }

  // --- Objects on the track -------------------------------------------------------------------
  _objects(dt) {
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i];
      o.age += dt;
      let dead = false;
      if (o.type === ITEM.ORB) {
        dead = o.age > R.ORB_LIFE_S;
        if (!dead) dead = this._fly(o, dt, true);
      } else if (o.type === ITEM.OIL) {
        dead = o.age > R.OIL_LIFE_S;
        if (!o.armed) {
          const ow = o.owner.s;
          const clear = R.OIL_RADIUS + KART_PHYS.RADIUS + 4;
          if (o.age > R.OIL_GRACE_S || (ow.x - o.x) ** 2 + (ow.y - o.y) ** 2 > clear * clear) o.armed = true;
        }
      } else if (o.type === ITEM.ROCKET) {
        dead = o.age > R.ROCKET_LIFE_S;
        if (!dead) this._steerRocket(o, dt);
      } else if (o.type === ITEM.BOMB) {
        if (o.age >= R.BOMB_FLIGHT_S) {
          this._explode(o);
          dead = true;
        } else this._fly(o, dt, false);
      }
      if (!dead && o.type !== ITEM.BOMB) dead = this._hits(o);
      if (dead) this.objects.splice(i, 1);
    }
  }

  // Straight flight in two sub-steps, bouncing off the barriers. On the
  // ground (bounce = true) it drops off an edge without a barrier or into a
  // gap: returns true when it is gone.
  _fly(o, dt, bounce) {
    for (let sub = 0; sub < 2; sub++) {
      o.x += (o.vx * dt) / 2;
      o.y += (o.vy * dt) / 2;
      const q = this._where(o);
      const lat = Math.abs(q.lateral);
      if (bounce && (q.gap || (q.wall < 0 && lat > q.half + FALL_EDGE))) return true;
      if (q.wall < 0) continue;
      const out = lat - (q.half + q.wall - 4);
      if (out <= 0) continue;
      const vn = o.vx * q.ox + o.vy * q.oy;
      if (vn > 0) {
        o.vx -= 2 * vn * q.ox;
        o.vy -= 2 * vn * q.oy;
      }
      o.x -= q.ox * out;
      o.y -= q.oy * out;
    }
    return false;
  }

  // A rocket follows the road towards its target (the kart one place ahead),
  // then locks on. Without a target it just races along the track.
  _steerRocket(o, dt) {
    const track = this.game.track;
    const q = this.q;
    if (o.target && (o.target.finished || !this.game.karts.includes(o.target))) o.target = null;
    trackQuery(track, o.x, o.y, q, o.seg);
    let aimX;
    let aimY;
    const t = o.target?.s;
    if (t && (t.x - o.x) ** 2 + (t.y - o.y) ** 2 < ROCKET_LOCK * ROCKET_LOCK) {
      aimX = t.x;
      aimY = t.y;
    } else {
      const p = pointAt(track, q.dist + ROCKET_LOOK);
      aimX = p.x;
      aimY = p.y;
    }
    const speed = Math.hypot(o.vx, o.vy) || R.ROCKET_SPEED;
    const want = Math.atan2(aimY - o.y, aimX - o.x);
    const cur = Math.atan2(o.vy, o.vx);
    let turn = want - cur;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    const max = R.ROCKET_TURN * dt;
    const a = cur + Math.max(-max, Math.min(max, turn));
    o.vx = Math.cos(a) * speed;
    o.vy = Math.sin(a) * speed;
    this._fly(o, dt, false);
  }

  _explode(o) {
    this.room.emit('boom', { x: Math.round(o.x), y: Math.round(o.y) });
    for (const k of this.game.karts) {
      if (k.finished || (k.s.x - o.x) ** 2 + (k.s.y - o.y) ** 2 > R.BOMB_RADIUS * R.BOMB_RADIUS) continue;
      if (Math.abs(this._alt(k) - o.h) > R.BOMB_RADIUS * 0.6) continue;
      if (this.protectedKart(k)) this.room.emit('block', { s: k.player.slot, x: Math.round(k.s.x), y: Math.round(k.s.y) });
      else this.spin(k, o.owner, R.SPIN_S, ITEM.BOMB, k.s.x, k.s.y);
    }
  }

  // Did a kart drive into this object during the last tick?
  _hits(o) {
    const radius = o.type === ITEM.ORB ? R.ORB_RADIUS : o.type === ITEM.ROCKET ? R.ROCKET_RADIUS : R.OIL_RADIUS;
    const reach = KART_PHYS.RADIUS + radius;
    for (const k of this.game.karts) {
      if (k === o.owner && (!o.armed || o.age < ORB_GRACE_S)) continue;
      if (k.s.fall > 0 || segDist2(o.x, o.y, k.px, k.py, k.s.x, k.s.y) > reach * reach) continue;
      if (Math.abs(this._alt(k) - o.h) > REACH_UP) continue; // jumped over it, or on another level
      if (this.protectedKart(k)) {
        this.room.emit('block', { s: k.player.slot, x: Math.round(o.x), y: Math.round(o.y) });
      } else {
        this.spin(k, o.owner, R.SPIN_S, o.type, o.x, o.y);
      }
      return true;
    }
    return false;
  }

  protectedKart(k) {
    return k.shield > 0 || k.star > 0;
  }

  // Spin a kart out (by: who did it, item: with what, x/y: where, for the effect).
  spin(k, by, seconds, item, x, y) {
    k.s.spin = Math.fround(Math.max(k.s.spin, seconds));
    k.s.drift = 0;
    k.s.charge = 0;
    this.room.emit('spin', { s: k.player.slot, by: by.player.slot, item, x: Math.round(x), y: Math.round(y) });
  }

  // Snapshot part: u16 boxMask, u8 m × [u16 id, u8 type, i16 x*4, i16 y*4, i16 h*4, u8 aux]
  // aux: a bomb's flight (0..255), 0 otherwise.
  write(w, itemsOn) {
    let mask = 0;
    for (let i = 0; i < this.boxes.length && i < 16; i++) if (this.boxes[i] <= 0) mask |= 1 << i;
    w.u16(itemsOn ? mask : 0);
    w.u8(this.objects.length);
    for (const o of this.objects) {
      const aux = o.type === ITEM.BOMB ? Math.min(255, Math.round((o.age / R.BOMB_FLIGHT_S) * 255)) : 0;
      w.u16(o.id).u8(o.type).i16(Math.round(o.x * 4)).i16(Math.round(o.y * 4)).i16(Math.round(o.h * 4)).u8(aux);
    }
  }
}

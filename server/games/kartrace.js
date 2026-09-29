// Turbo Kart GP (server side): races on spline tracks, laps with
// checkpoints, positions, item boxes, orbs and oil, a Grand Prix over three
// tracks, and bots that follow a racing line.
import { stepKart, createKartState, KART_PHYS } from '../../shared/physics/kart.js';
import { KART_TRACKS, KART_TRACK_IDS, trackQuery, WALL_MARGIN } from '../../shared/maps/kart-tracks.js';
import { KART_PHASE, KART_RULES as R, ITEM, KART_FLAG } from '../../shared/games/kartrace.js';
import { createRng } from '../../shared/rng.js';
import { InputQueue } from '../inputqueue.js';
import { createKartBot, stepKartBot } from './kartrace-bots.js';

const END_HOLD_S = 1;
const ALL_HUMANS_DONE_S = 3; // everybody who plays for real is through: wrap up quickly
const MAX_OBJECTS = 40;

class KartGame {
  constructor(room, settings) {
    this.room = room;
    this.rng = createRng(settings.seed);
    this.laps = settings.laps ?? 3;
    this.itemsOn = settings.items !== false;
    this.trackIds = settings.track === 'gp' ? [...KART_TRACK_IDS] : [KART_TRACKS[settings.track] ? settings.track : 'ring'];
    this.time = 0;
    this.raceNo = 0;
    this.karts = [];
    this.objects = [];
    this.nextObjectId = 1;
    this.q = { seg: 0, dist: 0, lateral: 0, nx: 0, ny: 0 };
    for (const p of room.gamePlayers()) this.onJoin(p);
    this._startRace();
  }

  get gp() {
    return this.trackIds.length > 1;
  }

  // ---------------------------------------------------------------------------
  // Players
  // ---------------------------------------------------------------------------
  _kart(id) {
    return this.karts.find((k) => k.player.id === id) ?? null;
  }

  onJoin(player) {
    if (this._kart(player.id)) return;
    const k = {
      player, s: createKartState(), queue: new InputQueue(), bot: createKartBot(),
      lap: 0, cp: 3, prevFrac: 1, raceDist: 0, finished: false, finishTime: 0, place: this.karts.length + 1,
      lapStart: 0, bestLap: 0, shield: 0, points: 0, history: [], bumpAt: 0,
    };
    this.karts.push(k);
    if (this.track) this._placeOnGrid(k, this.karts.length - 1);
  }

  onLeave(player) {
    this.karts = this.karts.filter((k) => k.player.id !== player.id);
  }

  onReconnect(player) {
    const k = this._kart(player.id);
    if (k) k.queue = new InputQueue();
  }

  onInput(player, input) {
    this._kart(player.id)?.queue.push(input);
  }

  // ---------------------------------------------------------------------------
  // Race lifecycle
  // ---------------------------------------------------------------------------
  _startRace() {
    this.raceNo++;
    this.track = KART_TRACKS[this.trackIds[this.raceNo - 1]];
    this.phase = KART_PHASE.COUNTDOWN;
    this.phaseEnd = this.time + R.COUNTDOWN_S;
    this.raceTime = 0;
    this.endAt = Infinity;
    this.finishers = 0;
    this.boxes = new Float32Array(this.track.boxes.length); // respawn timers, 0 = ready
    this.objects.length = 0;
    // Grand Prix: the leader in points starts in front.
    const order = [...this.karts].sort((a, b) => b.points - a.points || a.player.slot - b.player.slot);
    order.forEach((k, i) => this._placeOnGrid(k, i));
    this.room.emit('race', { n: this.raceNo, track: this.track.id });
  }

  _placeOnGrid(k, i) {
    const g = this.track.grid[i % this.track.grid.length];
    const s = createKartState();
    s.x = g.x;
    s.y = g.y;
    s.hx = g.hx;
    s.hy = g.hy;
    k.s = s;
    Object.assign(k, { lap: 0, cp: 3, prevFrac: 1, raceDist: -1, finished: false, finishTime: 0, lapStart: 0, bestLap: 0, shield: 0, place: i + 1 });
  }

  tick(dt) {
    this.time += dt;
    if (this.phase === KART_PHASE.COUNTDOWN) {
      this._drainInputs();
      if (this.time >= this.phaseEnd) {
        this.phase = KART_PHASE.RACE;
        this.room.emit('go');
      }
      return;
    }
    if (this.phase === KART_PHASE.RESULTS) {
      this._drainInputs();
      if (this.time >= this.phaseEnd) this._startRace();
      return;
    }
    if (this.phase === KART_PHASE.END) {
      this._drainInputs();
      if (this.time >= this.phaseEnd) this.room.endGame(this.results());
      return;
    }

    // --- RACE ---
    this.raceTime += dt;
    for (const k of this.karts) this._stepKart(k, dt);
    this._bumps();
    if (this.itemsOn) {
      this._stepBoxes(dt);
      this._stepObjects(dt);
    }
    for (const k of this.karts) this._progress(k);
    this._rank();

    const humansLeft = this.karts.some((k) => !k.finished && !k.player.isBot && k.player.connected);
    if (this.finishers > 0 && !humansLeft) this.endAt = Math.min(this.endAt, this.raceTime + ALL_HUMANS_DONE_S);
    if (this.raceTime >= this.endAt || this.raceTime > this.laps * R.LAP_CAP_S || this.finishers === this.karts.length) {
      this._endRace();
    }
  }

  _drainInputs() {
    for (const k of this.karts) {
      k.queue.beginTick();
      while (k.queue.next());
    }
  }

  _stepKart(k, dt) {
    if (k.shield > 0) k.shield = Math.max(0, k.shield - dt);
    const s = k.s;
    if (k.player.isBot) {
      const inp = stepKartBot(k, this, dt, this.rng);
      stepKart(s, inp.ax, inp.ay, inp.buttons, dt, this.track);
      this._afterStep(k);
      return;
    }
    const q = k.queue;
    q.beginTick();
    let applied = 0;
    for (let input = q.next(); input; input = q.next()) {
      stepKart(s, input.ax, input.ay, input.buttons, dt, this.track);
      this._afterStep(k);
      applied++;
    }
    q.endTick(applied);
  }

  _afterStep(k) {
    const s = k.s;
    if (s.wall && Math.abs(s.v) > 60 && this.rng() < 0.2) this.room.emit('scrape', { s: k.player.slot });
    if (!s.fired) return;
    if (!this.itemsOn || k.finished) return;
    this._useItem(k, s.fired);
  }

  // Positions, laps and the finish line.
  _progress(k) {
    const L = this.track.length;
    trackQuery(this.track, k.s.x, k.s.y, this.q);
    const frac = this.q.dist / L;
    if (k.cp === 0 && frac >= 0.25 && frac < 0.5) k.cp = 1;
    else if (k.cp === 1 && frac >= 0.5 && frac < 0.75) k.cp = 2;
    else if (k.cp === 2 && frac >= 0.75) k.cp = 3;
    if (k.prevFrac > 0.8 && frac < 0.2 && k.cp === 3) {
      k.lap++;
      k.cp = 0;
      if (k.lap > 1) {
        const lapTime = this.raceTime - k.lapStart;
        if (!k.bestLap || lapTime < k.bestLap) k.bestLap = lapTime;
      }
      k.lapStart = this.raceTime;
      if (k.lap > this.laps && !k.finished) this._finish(k);
      else if (k.lap > 1) this.room.emit('lap', { s: k.player.slot, lap: k.lap });
    } else if (k.prevFrac < 0.2 && frac > 0.8 && k.cp === 0 && k.lap > 0) {
      k.lap--; // reversed over the line
      k.cp = 3;
    }
    k.prevFrac = frac;
    if (!k.finished) k.raceDist = k.lap === 0 ? this.q.dist - L : (k.lap - 1) * L + this.q.dist;
  }

  _finish(k) {
    k.finished = true;
    k.finishTime = this.raceTime;
    this.finishers++;
    k.raceDist = 1e9 - this.finishers; // finishers keep their order
    if (this.finishers === 1) this.endAt = this.raceTime + R.FINISH_GRACE_S;
    this.room.emit('finish', { s: k.player.slot, place: this.finishers, ms: Math.round(k.finishTime * 1000) });
  }

  _rank() {
    const order = [...this.karts].sort((a, b) => b.raceDist - a.raceDist);
    order.forEach((k, i) => { k.place = i + 1; });
  }

  _endRace() {
    this._rank();
    const order = [...this.karts].sort((a, b) => a.place - b.place);
    order.forEach((k, i) => {
      k.points += R.POINTS[i] ?? 0;
      k.history.push(i + 1);
    });
    this.room.emit('raceEnd', { order: order.map((k) => k.player.slot) });
    this.phase = this.raceNo < this.trackIds.length ? KART_PHASE.RESULTS : KART_PHASE.END;
    this.phaseEnd = this.time + (this.phase === KART_PHASE.RESULTS ? R.RESULTS_S : R.RESULTS_S * 0.6 + END_HOLD_S);
  }

  // Karts bump into each other (server only; prediction corrects).
  _bumps() {
    const min = R.BUMP_RADIUS * 2;
    for (let i = 0; i < this.karts.length; i++) {
      const a = this.karts[i].s;
      for (let j = i + 1; j < this.karts.length; j++) {
        const b = this.karts[j].s;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= min || d < 1e-6) continue;
        const push = (min - d) / 2;
        const nx = dx / d;
        const ny = dy / d;
        a.x = Math.fround(a.x - nx * push);
        a.y = Math.fround(a.y - ny * push);
        b.x = Math.fround(b.x + nx * push);
        b.y = Math.fround(b.y + ny * push);
        a.v = Math.fround(a.v * 0.97);
        b.v = Math.fround(b.v * 0.97);
        const ka = this.karts[i];
        const kb = this.karts[j];
        if (this.time > ka.bumpAt && this.time > kb.bumpAt) {
          ka.bumpAt = kb.bumpAt = this.time + 0.8; // one bump sound per contact, not per tick
          this.room.emit('bump', { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------
  _stepBoxes(dt) {
    const boxes = this.track.boxes;
    for (let i = 0; i < boxes.length; i++) {
      if (this.boxes[i] > 0) {
        this.boxes[i] = Math.max(0, this.boxes[i] - dt);
        continue;
      }
      for (const k of this.karts) {
        if (k.finished || Math.hypot(k.s.x - boxes[i].x, k.s.y - boxes[i].y) > R.BOX_RADIUS + KART_PHYS.RADIUS) continue;
        this.boxes[i] = R.BOX_RESPAWN_S;
        if (k.s.item === ITEM.NONE) {
          k.s.item = this._rollItem(k);
          this.room.emit('item', { s: k.player.slot, item: k.s.item });
        }
        this.room.emit('box', { i });
        break;
      }
    }
  }

  // Better items for the karts at the back.
  _rollItem(k) {
    const n = Math.max(1, this.karts.length - 1);
    const back = (k.place - 1) / n; // 0 = leading, 1 = last
    const weights = [
      [ITEM.TURBO, 0.2 + back * 0.4],
      [ITEM.ORB, 0.35],
      [ITEM.OIL, 0.4 - back * 0.3],
      [ITEM.SHIELD, 0.05 + back * 0.2],
    ];
    const total = weights.reduce((a, [, w]) => a + w, 0);
    let roll = this.rng() * total;
    for (const [item, w] of weights) {
      roll -= w;
      if (roll <= 0) return item;
    }
    return ITEM.TURBO;
  }

  _useItem(k, item) {
    const s = k.s;
    if (item === ITEM.SHIELD) {
      k.shield = R.SHIELD_S;
    } else if (this.objects.length < MAX_OBJECTS) {
      const ahead = item === ITEM.ORB ? KART_PHYS.RADIUS + 8 : -(KART_PHYS.RADIUS + 9);
      const speed = item === ITEM.ORB ? R.ORB_SPEED + Math.max(0, s.v) * 0.5 : 0;
      this.objects.push({
        id: this.nextObjectId, type: item, owner: k,
        x: s.x + s.hx * ahead, y: s.y + s.hy * ahead,
        vx: s.hx * speed, vy: s.hy * speed, age: 0,
      });
      this.nextObjectId = (this.nextObjectId % 65535) + 1;
    }
    this.room.emit('use', { s: k.player.slot, item });
  }

  _stepObjects(dt) {
    const limit = this.track.half + WALL_MARGIN - 4;
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i];
      o.age += dt;
      let dead = o.age > (o.type === ITEM.ORB ? R.ORB_LIFE_S : R.OIL_LIFE_S);
      if (!dead && o.type === ITEM.ORB) {
        for (let sub = 0; sub < 2; sub++) {
          o.x += o.vx * dt / 2;
          o.y += o.vy * dt / 2;
          trackQuery(this.track, o.x, o.y, this.q);
          if (Math.abs(this.q.lateral) > limit) {
            // Bounce off the barrier.
            const sign = this.q.lateral > 0 ? 1 : -1;
            const nx = this.q.nx * sign;
            const ny = this.q.ny * sign;
            const vn = o.vx * nx + o.vy * ny;
            if (vn > 0) {
              o.vx -= 2 * vn * nx;
              o.vy -= 2 * vn * ny;
            }
            o.x -= nx * (Math.abs(this.q.lateral) - limit);
            o.y -= ny * (Math.abs(this.q.lateral) - limit);
          }
        }
      }
      if (!dead) dead = this._objectHits(o);
      if (dead) this.objects.splice(i, 1);
    }
  }

  _objectHits(o) {
    const reach = KART_PHYS.RADIUS + (o.type === ITEM.ORB ? R.ORB_RADIUS : R.OIL_RADIUS);
    for (const k of this.karts) {
      if (o.type === ITEM.ORB && k === o.owner && o.age < 0.4) continue;
      if (Math.hypot(k.s.x - o.x, k.s.y - o.y) > reach) continue;
      if (k.shield > 0) {
        this.room.emit('block', { s: k.player.slot, x: Math.round(o.x), y: Math.round(o.y) });
      } else {
        k.s.spin = Math.fround(R.SPIN_S);
        k.s.drift = 0;
        this.room.emit('spin', { s: k.player.slot, by: o.owner.player.slot, x: Math.round(o.x), y: Math.round(o.y) });
      }
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Snapshot + results
  // ---------------------------------------------------------------------------
  // Body layout (after the 14-byte header), decoded in public/games/kartrace/client.js:
  // u8 phase, u8 track, u8 raceNo, u8 races, u8 laps, f32 phaseRemaining, f32 raceTime,
  // u8 n × [u8 slot, u8 flags, u16 ack, f32 x, f32 y, f32 hx, f32 hy, f32 v, f32 vs,
  //         i8 drift, f32 charge, f32 boost, f32 spin, u8 item, u8 prev, u8 off,
  //         u8 lap, u8 place, f32 finishTime, u16 points]
  // u16 boxMask, u8 m × [u16 id, u8 type, i16 x*4, i16 y*4]
  snapshot(w) {
    const remaining = this.phase === KART_PHASE.RACE ? (Number.isFinite(this.endAt) ? this.endAt - this.raceTime : 0) : this.phaseEnd - this.time;
    w.u8(this.phase).u8(KART_TRACK_IDS.indexOf(this.track.id)).u8(this.raceNo).u8(this.trackIds.length).u8(this.laps);
    w.f32(Math.max(0, remaining)).f32(this.raceTime);
    w.u8(this.karts.length);
    for (const k of this.karts) {
      const p = k.player;
      const s = k.s;
      const flags = (p.isBot ? KART_FLAG.BOT : 0) | (p.isBot || p.connected ? KART_FLAG.CONNECTED : 0)
        | (k.finished ? KART_FLAG.FINISHED : 0) | (k.shield > 0 ? KART_FLAG.SHIELD : 0);
      w.u8(p.slot).u8(flags).u16(k.queue.ackSeq);
      w.f32(s.x).f32(s.y).f32(s.hx).f32(s.hy).f32(s.v).f32(s.vs);
      w.i8(s.drift).f32(s.charge).f32(s.boost).f32(s.spin).u8(s.item).u8(s.prev).u8(s.off);
      w.u8(Math.min(255, k.lap)).u8(k.place).f32(k.finishTime).u16(Math.min(65535, k.points));
    }
    let mask = 0;
    for (let i = 0; i < this.boxes.length && i < 16; i++) if (this.boxes[i] <= 0) mask |= 1 << i;
    w.u16(this.itemsOn ? mask : 0);
    w.u8(this.objects.length);
    for (const o of this.objects) w.u16(o.id).u8(o.type).i16(Math.round(o.x * 4)).i16(Math.round(o.y * 4));
  }

  results() {
    const gp = this.gp;
    const sorted = [...this.karts].sort((a, b) => (gp ? b.points - a.points : 0) || a.place - b.place);
    const time = (t) => {
      const m = Math.floor(t / 60);
      const sec = t - m * 60;
      return `${m}:${sec.toFixed(1).padStart(4, '0').replace('.', ',')}`;
    };
    return {
      title: gp ? 'Uitslag Turbo Kart GP' : `Uitslag ${this.track.name}`,
      columns: gp ? ['Punten', 'Plaatsen'] : ['Tijd', 'Snelste ronde'],
      rows: sorted.map((k, i) => ({
        id: k.player.id,
        name: k.player.name,
        color: k.player.color,
        rank: i + 1,
        values: gp
          ? [String(k.points), k.history.join(' · ')]
          : [k.finished ? time(k.finishTime) : 'niet gefinisht', k.bestLap ? time(k.bestLap) : '–'],
      })),
    };
  }
}

export default {
  id: 'kartrace',
  realtime: true,
  create: (room, settings) => new KartGame(room, settings),
};

// Turbo Kart GP (server side): races on spline tracks (some with hills),
// laps with checkpoints, positions, karts bumping into each other, a Grand
// Prix over three or four tracks, and bots that follow a racing line. Items
// live in kartrace-items.js, kart-to-kart collisions in kartrace-collide.js.
import { stepKart, createKartState } from '../../shared/physics/kart.js';
import { KART_TRACKS, KART_TRACK_IDS, KART_CUPS, trackQuery, createTrackQuery } from '../../shared/maps/kart-tracks.js';
import { KART_PHASE, KART_RULES as R, KART_FLAG } from '../../shared/games/kartrace.js';
import { createRng } from '../../shared/rng.js';
import { InputQueue } from '../inputqueue.js';
import { createKartBot, stepKartBot } from './kartrace-bots.js';
import { KartItems } from './kartrace-items.js';
import { collideKarts } from './kartrace-collide.js';

const END_HOLD_S = 1;
const ALL_HUMANS_DONE_S = 3; // everybody who plays for real is through: wrap up quickly
const BUMP_SOUND = 40; // impact speed for a bump sound

class KartGame {
  constructor(room, settings) {
    this.room = room;
    this.rng = createRng(settings.seed);
    this.laps = settings.laps ?? 3;
    this.itemsOn = settings.items !== false;
    this.trackIds = KART_CUPS[settings.track] ? [...KART_CUPS[settings.track]] : [KART_TRACKS[settings.track] ? settings.track : 'ring'];
    this.time = 0;
    this.raceNo = 0;
    this.karts = [];
    this.items = new KartItems(this);
    this.q = createTrackQuery();
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
      lapStart: 0, bestLap: 0, shield: 0, star: 0, points: 0, history: [], bumpAt: 0,
      px: 0, py: 0, // where the kart was at the start of this tick (for hit tests along its path)
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
    this.items.reset(this.track);
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
    s.seg = g.seg;
    k.s = s;
    Object.assign(k, { lap: 0, cp: 3, prevFrac: 1, raceDist: -1, finished: false, finishTime: 0, lapStart: 0, bestLap: 0, shield: 0, star: 0, place: i + 1, px: s.x, py: s.y });
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
    for (const k of this.karts) {
      k.px = k.s.x;
      k.py = k.s.y;
    }
    for (const k of this.karts) this._stepKart(k, dt);
    this._bumps(dt);
    if (this.itemsOn) this.items.tick(dt);
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
    if (k.star > 0) k.star = Math.max(0, k.star - dt);
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
    if (s.fell) this.room.emit('fall', { s: k.player.slot, x: Math.round(s.x), y: Math.round(s.y) });
    if (s.landed === 2) this.room.emit('trick', { s: k.player.slot });
    if (!s.fired) return;
    if (!this.itemsOn || k.finished) return;
    this.items.use(k, s.fired);
  }

  // Positions, laps and the finish line.
  _progress(k) {
    const L = this.track.length;
    trackQuery(this.track, k.s.x, k.s.y, this.q, k.s.seg);
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

  // Karts bump into each other (server only; the owner's prediction corrects
  // smoothly). A superstar spins whoever it hits.
  _bumps(dt) {
    collideKarts(this.karts, this.track, dt, (ka, kb, impact) => {
      const a = ka.s;
      const b = kb.s;
      if (ka.star > 0 && kb.star <= 0 && !this.items.protectedKart(kb)) this.items.spin(kb, ka, R.SPIN_S, 0, b.x, b.y);
      else if (kb.star > 0 && ka.star <= 0 && !this.items.protectedKart(ka)) this.items.spin(ka, kb, R.SPIN_S, 0, a.x, a.y);
      if (impact > BUMP_SOUND && this.time > ka.bumpAt && this.time > kb.bumpAt) {
        ka.bumpAt = kb.bumpAt = this.time + 0.5; // one bump sound per contact, not per tick
        this.room.emit('bump', { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2), p: Math.min(255, Math.round(impact)) });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Snapshot + results
  // ---------------------------------------------------------------------------
  // Body layout (after the 14-byte header), decoded in public/games/kartrace/client.js:
  // u8 phase, u8 track, u8 raceNo, u8 races, u8 laps, f32 phaseRemaining, f32 raceTime,
  // u8 n × [u8 slot, u8 flags, u16 ack, f32 x, f32 y, f32 hx, f32 hy, f32 v, f32 vs,
  //         i8 drift, f32 charge, f32 boost, f32 spin, u8 item, u8 prev, u8 off,
  //         f32 z, f32 vz, u16 seg, f32 fall, u8 trick,
  //         u8 lap, u8 place, f32 finishTime, u16 points]
  // then the items: see KartItems.write.
  snapshot(w) {
    const remaining = this.phase === KART_PHASE.RACE ? (Number.isFinite(this.endAt) ? this.endAt - this.raceTime : 0) : this.phaseEnd - this.time;
    w.u8(this.phase).u8(KART_TRACK_IDS.indexOf(this.track.id)).u8(this.raceNo).u8(this.trackIds.length).u8(this.laps);
    w.f32(Math.max(0, remaining)).f32(this.raceTime);
    w.u8(this.karts.length);
    for (const k of this.karts) {
      const p = k.player;
      const s = k.s;
      const flags = (p.isBot ? KART_FLAG.BOT : 0) | (p.isBot || p.connected ? KART_FLAG.CONNECTED : 0)
        | (k.finished ? KART_FLAG.FINISHED : 0) | (k.shield > 0 ? KART_FLAG.SHIELD : 0) | (k.star > 0 ? KART_FLAG.STAR : 0);
      w.u8(p.slot).u8(flags).u16(k.queue.ackSeq);
      w.f32(s.x).f32(s.y).f32(s.hx).f32(s.hy).f32(s.v).f32(s.vs);
      w.i8(s.drift).f32(s.charge).f32(s.boost).f32(s.spin).u8(s.item).u8(s.prev).u8(s.off);
      w.f32(s.z).f32(s.vz).u16(Math.max(0, s.seg)).f32(s.fall).u8(s.trick);
      w.u8(Math.min(255, k.lap)).u8(k.place).f32(k.finishTime).u16(Math.min(65535, k.points));
    }
    this.items.write(w, this.itemsOn);
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

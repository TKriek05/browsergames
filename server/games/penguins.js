// Pinguïnbotsen (server side): penguins on a melting ice floe. The shared
// movement is predicted by each owner; bumps and falling into the sea are
// decided here (penguins-collide.js: sub-steps, so nobody slides through
// anyone). A dash hit adds a punch and stuns the victim for a moment. Last
// penguin on the ice wins the round; first to N rounds wins. Optional
// power-ups: penguins-powers.js.
import { ArcadeGame } from './arcade.js';
import { ARCADE_PHASE } from '../../shared/games/arcade.js';
import { PG, PG_FLAG, PG_POWER_RULES as PR, createPenguin, stepPenguin, penguinMass, floeRadius } from '../../shared/games/penguins.js';
import { BTN } from '../../shared/messages.js';
import { stepPenguinBot, createPenguinBot } from './penguins-bots.js';
import { collide } from './penguins-collide.js';
import { PenguinPowers } from './penguins-powers.js';

const ROUND_END_S = 3;
const START_RING = 68;
const SINK_S = 1.4;
const PUSH_CREDIT_S = 3; // a fall within this time after a bump counts for the pusher
const BUMP_EVENT = 45; // impact speed for a sound/effect
const DASH_HIT = 20; // approach speed of a dashing penguin that counts as a dash hit
const PUNCH_KNOCK = 1.6; // punch power-up: the knockback cap and stun grow by this much
const ds = (t) => Math.min(255, Math.ceil(Math.max(0, t) * 10));

class PenguinGame extends ArcadeGame {
  constructor(room, settings) {
    super(room, settings, { countdown: 3, endHold: 4 });
    this.target = settings.wins ?? PG.ROUND_WINS;
    this.round = 0;
    this.roundTime = 0;
    this.radius = PG.FLOE_START;
    this.powers = new PenguinPowers(this, settings.powerups !== false);
    this.onHit = (a, b, impact, nx, ny, va, vb) => this._hit(a, b, impact, nx, ny, va, vb);
    this.massOf = (e) => penguinMass(e.s) * (e.heavy > 0 ? PR.HEAVY_MASS : 1);
    this.addPlayers();
    this._newRound();
  }

  createEntity() {
    return { s: createPenguin(), alive: false, sink: 0, wins: 0, pushes: 0, falls: 0, hit: null, heavy: 0, punch: 0, px: 0, py: 0, bot: createPenguinBot() };
  }

  onJoin(player) {
    super.onJoin(player);
    // Late joiners watch until the next round.
    if (this.round > 0 && this.phase !== ARCADE_PHASE.COUNTDOWN) this.ent(player.id).alive = false;
    else if (this.round > 0) this._placeAll();
  }

  _newRound() {
    this.round++;
    this.roundTime = 0;
    this.radius = PG.FLOE_START;
    this.startCountdown();
    this.powers.reset();
    this._placeAll();
    this.room.emit('round', { r: this.round });
  }

  // Spread over a ring, facing the middle.
  _placeAll() {
    const n = this.ents.length;
    this.ents.forEach((e, i) => {
      const a = (i / n) * Math.PI * 2 + 0.3;
      const s = e.s;
      Object.assign(s, createPenguin(Math.fround(Math.cos(a) * START_RING), Math.fround(Math.sin(a) * START_RING)));
      s.fx = Math.fround(-Math.cos(a));
      s.fy = Math.fround(-Math.sin(a));
      e.alive = true;
      e.sink = 0;
      e.hit = null;
      PenguinPowers.clear(e);
    });
  }

  step(dt) {
    this.roundTime += dt;
    this.radius = floeRadius(this.roundTime);
    for (const e of this.ents) {
      if (!e.alive) {
        if (e.sink > 0) e.sink = Math.max(0, e.sink - dt);
        if (!e.player.isBot) this.eachInput(e, () => {});
        continue;
      }
      e.px = e.s.x;
      e.py = e.s.y;
      if (e.player.isBot) {
        const b = stepPenguinBot(e, this, dt, this.rng);
        stepPenguin(e.s, b.ax, b.ay, b.a, dt);
      } else {
        this.eachInput(e, (input) => stepPenguin(e.s, input.ax, input.ay, input.buttons & BTN.A, dt));
      }
    }
    this.powers.tick(dt);
    collide(this.ents.filter((e) => e.alive), dt, this.massOf, this.onHit);
    this._falls();
    this._checkRound();
  }

  // a bumped into b (n: normal a → b; va/vb: approach speeds before the bump).
  _hit(a, b, impact, nx, ny, va, vb) {
    // Who pushed whom: more momentum towards the other one.
    const pusher = va * this.massOf(a) >= vb * this.massOf(b) ? a : b;
    a.hit = { by: b, t: this.roundTime };
    b.hit = { by: a, t: this.roundTime };
    // A dash hit knocks the other one away and stuns it for a moment.
    if (a.s.dash > 0 && va > DASH_HIT) this._knock(a, b, nx, ny);
    if (b.s.dash > 0 && vb > DASH_HIT) this._knock(b, a, -nx, -ny);
    if (impact > BUMP_EVENT) {
      this.room.emit('bump', {
        x: Math.round((a.s.x + b.s.x) / 2), y: Math.round((a.s.y + b.s.y) / 2),
        p: Math.min(255, Math.round(impact)), s: pusher.player.slot,
      });
    }
  }

  // by dashed into v; (nx, ny) points from by to v.
  _knock(by, v, nx, ny) {
    const punch = by.punch > 0;
    const heavy = v.heavy > 0 ? PR.HEAVY_MASS : 1;
    const s = v.s;
    const push = (PG.PUNCH * (punch ? PR.PUNCH_FACTOR : 1)) / heavy;
    let vx = s.vx + nx * push;
    let vy = s.vy + ny * push;
    const cap = (PG.KNOCK_MAX * (punch ? PUNCH_KNOCK : 1)) / Math.sqrt(heavy);
    const sp = Math.hypot(vx, vy);
    if (sp > cap) {
      vx = (vx / sp) * cap;
      vy = (vy / sp) * cap;
    }
    s.vx = Math.fround(vx);
    s.vy = Math.fround(vy);
    s.stun = Math.fround(Math.max(s.stun, (PG.STUN_S * (punch ? PUNCH_KNOCK : 1)) / heavy));
    s.dash = 0;
    if (punch) {
      by.punch = 0;
      this.room.emit('punch', { s: by.player.slot, v: v.player.slot, x: Math.round(v.s.x), y: Math.round(v.s.y) });
    }
  }

  _falls() {
    for (const e of this.ents) {
      if (!e.alive) continue;
      const d = Math.hypot(e.s.x, e.s.y);
      if (d <= this.radius + 1) continue;
      e.alive = false;
      e.sink = SINK_S;
      e.falls++;
      const pusher = e.hit && this.roundTime - e.hit.t < PUSH_CREDIT_S && e.hit.by !== e ? e.hit.by : null;
      if (pusher) pusher.pushes++;
      this.room.emit('splash', { s: e.player.slot, x: Math.round(e.s.x), y: Math.round(e.s.y), by: pusher ? pusher.player.slot : -1 });
    }
  }

  _checkRound() {
    const alive = this.ents.filter((e) => e.alive);
    if (this.ents.length < 2 ? alive.length > 0 : alive.length > 1) return;
    const winner = alive[0] ?? null;
    if (winner) winner.wins++;
    this.endRound(ROUND_END_S, { s: winner ? winner.player.slot : -1 });
  }

  nextRound() {
    if (this.ents.some((e) => e.wins >= this.target)) this.finish();
    else this._newRound();
  }

  // Body: u8 phase, f32 left, u8 round, f32 floe radius,
  //   u8 n × [u8 slot, u8 flags, u16 ack, f32 x, y, vx, vy, fx, fy, dash, cool, stun, boost, grip, u8 prevA,
  //           u8 wins, u8 pushes, u8 sink (ds), u8 heavy (ds), u8 punch (ds)]
  //   power-ups on the ice (PenguinPowers.write)
  snapshot(w) {
    this.writePhase(w);
    w.u8(this.round).f32(this.radius);
    w.u8(this.ents.length);
    for (const e of this.ents) {
      const s = e.s;
      const flags = ArcadeGame.flags(e.player) | (e.alive ? PG_FLAG.ALIVE : 0) | (s.dash > 0 ? PG_FLAG.DASH : 0) | (e.sink > 0 ? PG_FLAG.FALLING : 0);
      w.u8(e.player.slot).u8(flags).u16(e.queue.ackSeq);
      w.f32(s.x).f32(s.y).f32(s.vx).f32(s.vy).f32(s.fx).f32(s.fy).f32(s.dash).f32(s.cool).f32(s.stun).f32(s.boost).f32(s.grip).u8(s.prevA);
      w.u8(Math.min(255, e.wins)).u8(Math.min(255, e.pushes)).u8(ds(e.sink)).u8(ds(e.heavy)).u8(ds(e.punch));
    }
    this.powers.write(w);
  }

  results() {
    const sorted = [...this.ents].sort((a, b) => b.wins - a.wins || b.pushes - a.pushes || a.falls - b.falls);
    return {
      title: 'Uitslag Pinguïnbotsen',
      columns: ['Rondes', 'Het water in geduwd', 'Zelf gevallen'],
      rows: this.rows(sorted, (e) => [e.wins, e.pushes, e.falls]),
    };
  }
}

export default {
  id: 'penguins',
  realtime: true,
  create: (room, settings) => new PenguinGame(room, settings),
};

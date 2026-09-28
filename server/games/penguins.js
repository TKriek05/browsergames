// Pinguïnbotsen (server side): penguins on a melting ice floe. The shared
// movement is predicted by each owner; bumps and falling into the sea are
// decided here. Last penguin on the ice wins the round; first to N rounds wins.
import { ArcadeGame } from './arcade.js';
import { ARCADE_PHASE } from '../../shared/games/arcade.js';
import { PG, PG_FLAG, createPenguin, stepPenguin, bump, floeRadius } from '../../shared/games/penguins.js';
import { BTN } from '../../shared/messages.js';
import { stepPenguinBot, createPenguinBot } from './penguins-bots.js';

const ROUND_END_S = 3;
const START_RING = 68;
const SINK_S = 1.4;
const PUSH_CREDIT_S = 3; // a fall within this time after a bump counts for the pusher
const BUMP_EVENT = 45; // impact speed for a sound/effect

class PenguinGame extends ArcadeGame {
  constructor(room, settings) {
    super(room, settings, { countdown: 3, endHold: 4 });
    this.target = settings.wins ?? PG.ROUND_WINS;
    this.round = 0;
    this.roundTime = 0;
    this.radius = PG.FLOE_START;
    this.addPlayers();
    this._newRound();
  }

  createEntity() {
    return { s: createPenguin(), alive: false, sink: 0, wins: 0, pushes: 0, falls: 0, hit: null, bot: createPenguinBot() };
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
      if (e.player.isBot) {
        const b = stepPenguinBot(e, this, dt, this.rng);
        stepPenguin(e.s, b.ax, b.ay, b.a, dt);
      } else {
        this.eachInput(e, (input) => stepPenguin(e.s, input.ax, input.ay, input.buttons & BTN.A, dt));
      }
    }
    this._bumps();
    this._falls();
    this._checkRound();
  }

  _bumps() {
    const list = this.ents.filter((e) => e.alive);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const impact = bump(a.s, b.s);
        if (!impact) continue;
        // Who pushed whom: the faster (or dashing) one gets the credit.
        const aPush = a.s.dash > b.s.dash || (a.s.dash === b.s.dash && Math.hypot(a.s.vx, a.s.vy) < Math.hypot(b.s.vx, b.s.vy));
        a.hit = { by: b, t: this.roundTime };
        b.hit = { by: a, t: this.roundTime };
        if (impact > BUMP_EVENT) {
          this.room.emit('bump', {
            x: Math.round((a.s.x + b.s.x) / 2), y: Math.round((a.s.y + b.s.y) / 2),
            p: Math.min(255, Math.round(impact)), s: (aPush ? a : b).player.slot,
          });
        }
      }
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
  //   u8 n × [u8 slot, u8 flags, u16 ack, f32 x, y, vx, vy, fx, fy, dash, cool, u8 prevA,
  //           u8 wins, u8 pushes, u8 sink (ds)]
  snapshot(w) {
    this.writePhase(w);
    w.u8(this.round).f32(this.radius);
    w.u8(this.ents.length);
    for (const e of this.ents) {
      const s = e.s;
      const flags = ArcadeGame.flags(e.player) | (e.alive ? PG_FLAG.ALIVE : 0) | (s.dash > 0 ? PG_FLAG.DASH : 0) | (e.sink > 0 ? PG_FLAG.FALLING : 0);
      w.u8(e.player.slot).u8(flags).u16(e.queue.ackSeq);
      w.f32(s.x).f32(s.y).f32(s.vx).f32(s.vy).f32(s.fx).f32(s.fy).f32(s.dash).f32(s.cool).u8(s.prevA);
      w.u8(Math.min(255, e.wins)).u8(Math.min(255, e.pushes)).u8(Math.ceil(e.sink * 10));
    }
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

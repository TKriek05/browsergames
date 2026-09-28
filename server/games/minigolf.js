// Minigolf (server side): everybody plays the same hole at the same time
// (balls pass through each other). A shot is a one-off JSON action
// { a: angle, p: power 0..1 }, only allowed while your ball lies still.
// Water = one penalty stroke and back to where you shot from.
import { ArcadeGame } from './arcade.js';
import { ARCADE_PHASE } from '../../shared/games/arcade.js';
import { HOLES, MAX_POWER, MAX_STROKES, wallSegments, stepBall, holeSet, BALL_STATE, GIVE_UP_SCORE } from '../../shared/games/minigolf.js';
import { shotSearch, addNoise, botSpread, botThinkTime } from './minigolf-bots.js';

const SUBSTEPS = 4; // 30 Hz tick → 120 Hz ball physics (same as the bots' simulation)
const HOLE_TIME_S = 90;
const ROUND_END_S = 4.5;
const BETWEEN_COUNTDOWN_S = 2;
const BOT_BUDGET_MS = 4; // time per tick all bots together may spend thinking
const EVENT_GAP_S = 0.12; // at most one bounce sound per ball this often

class MinigolfGame extends ArcadeGame {
  constructor(room, settings) {
    super(room, settings, { countdown: 3, endHold: 3 });
    this.course = holeSet(settings.holes);
    this.holeNo = 0;
    this.addPlayers();
    this._startHole();
  }

  get holeIndex() {
    return this.course[this.holeNo];
  }

  createEntity() {
    return {
      x: 0, y: 0, vx: 0, vy: 0, restX: 0, restY: 0,
      state: BALL_STATE.REST, strokes: 0, scores: [], aces: 0, eventT: 0, bot: {},
    };
  }

  onJoin(player) {
    super.onJoin(player);
    const e = this.ent(player.id);
    // Late joiners: holes they missed count as given up.
    const missed = this.phase === ARCADE_PHASE.ROUND_END || this.phase === ARCADE_PHASE.END ? this.holeNo + 1 : this.holeNo;
    while (e.scores.length < missed) e.scores.push(GIVE_UP_SCORE);
    if (this.hole) this._placeOnTee(e);
    if (e.scores.length > this.holeNo) e.state = BALL_STATE.OUT;
  }

  _placeOnTee(e) {
    const [x, y] = this.hole.tee;
    Object.assign(e, { x, y, vx: 0, vy: 0, restX: x, restY: y, state: BALL_STATE.REST, strokes: 0, bot: {} });
  }

  _startHole() {
    this.hole = HOLES[this.holeIndex];
    this.segs = wallSegments(this.hole);
    this.holeTime = 0;
    for (const e of this.ents) this._placeOnTee(e);
    this.room.emit('hole', { n: this.holeNo, i: this.holeIndex });
  }

  nextRound() {
    this.holeNo++;
    if (this.holeNo >= this.course.length) {
      this.holeNo = this.course.length - 1;
      this.finish({});
      return;
    }
    this._startHole();
    this.startCountdown(BETWEEN_COUNTDOWN_S);
  }

  onAction(player, data) {
    const e = this.ent(player.id);
    if (!e || player.isBot || !data || typeof data !== 'object') return;
    const { a, p } = data;
    if (!Number.isFinite(a) || !Number.isFinite(p)) return;
    this._shoot(e, a, p);
  }

  _shoot(e, angle, power) {
    if (this.phase !== ARCADE_PHASE.PLAY || e.state !== BALL_STATE.REST) return false;
    const p = Math.max(0.03, Math.min(1, power));
    e.vx = Math.cos(angle) * p * MAX_POWER;
    e.vy = Math.sin(angle) * p * MAX_POWER;
    e.restX = e.x;
    e.restY = e.y;
    e.state = BALL_STATE.ROLLING;
    e.strokes++;
    this.room.emit('shot', { s: e.player.slot, p: Math.round(p * 100) / 100 });
    return true;
  }

  step(dt) {
    this.drain(); // no binary input in this game
    this.holeTime += dt;
    this._stepBots(dt);
    const h = dt / SUBSTEPS;
    for (const e of this.ents) {
      e.eventT = Math.max(0, e.eventT - dt);
      if (e.state !== BALL_STATE.ROLLING) continue;
      for (let i = 0; i < SUBSTEPS && e.state === BALL_STATE.ROLLING; i++) this._stepBall(e, h);
    }
    const open = this.ents.filter((e) => e.state === BALL_STATE.REST || e.state === BALL_STATE.ROLLING);
    if (!this.ents.length || !open.length || this.holeTime >= HOLE_TIME_S) this._endHole();
  }

  _stepBall(e, dt) {
    const ev = stepBall(e, this.hole, this.segs, dt);
    if (!ev) return;
    const slot = e.player.slot;
    switch (ev) {
      case 'sink':
        e.x = this.hole.cup[0];
        e.y = this.hole.cup[1];
        e.vx = e.vy = 0;
        e.state = BALL_STATE.SUNK;
        if (e.strokes === 1) e.aces++;
        this.room.emit('sink', { s: slot, n: e.strokes });
        return;
      case 'water':
        this.room.emit('splash', { s: slot, x: Math.round(e.x), y: Math.round(e.y) });
        e.x = e.restX;
        e.y = e.restY;
        e.vx = e.vy = 0;
        e.strokes++; // penalty stroke
        this._rest(e);
        return;
      case 'stop':
        this._rest(e);
        return;
      default:
        if (e.eventT <= 0) {
          e.eventT = EVENT_GAP_S;
          this.room.emit(ev, { s: slot, x: Math.round(e.x), y: Math.round(e.y) });
        }
    }
  }

  _rest(e) {
    e.state = e.strokes >= MAX_STROKES ? BALL_STATE.OUT : BALL_STATE.REST;
    e.bot = {};
    if (e.state === BALL_STATE.OUT) this.room.emit('out', { s: e.player.slot });
  }

  _stepBots(dt) {
    const deadline = performance.now() + BOT_BUDGET_MS;
    for (const e of this.ents) {
      if (!e.player.isBot || e.state !== BALL_STATE.REST) continue;
      const b = e.bot;
      const level = e.player.botLevel;
      if (!b.search) {
        b.search = shotSearch(this.holeIndex, this.segs, e.x, e.y, botSpread(level));
        b.wait = botThinkTime(level, this.rng);
        b.shot = null;
      }
      b.wait -= dt;
      while (!b.shot && performance.now() < deadline) {
        const r = b.search.next();
        if (r.done) b.shot = addNoise(r.value, this.holeIndex, e.x, e.y, level, this.rng);
      }
      if (b.shot && b.wait <= 0) this._shoot(e, b.shot.a, b.shot.p);
    }
  }

  _endHole() {
    for (const e of this.ents) {
      const holed = e.state === BALL_STATE.SUNK;
      e.state = holed ? BALL_STATE.SUNK : BALL_STATE.OUT;
      e.vx = e.vy = 0;
      e.scores[this.holeNo] = holed ? e.strokes : GIVE_UP_SCORE;
    }
    const best = Math.min(...this.ents.map((e) => e.scores[this.holeNo]));
    const winners = this.ents.filter((e) => e.scores[this.holeNo] === best);
    this.endRound(ROUND_END_S, { n: this.holeNo, s: winners.length === 1 ? winners[0].player.slot : -1 });
  }

  total(e) {
    let t = 0;
    for (let i = 0; i <= this.holeNo && i < e.scores.length; i++) t += e.scores[i] ?? 0;
    return t;
  }

  // Body: u8 phase, f32 left, u8 holeNo, u8 holes, u8 hole index, then
  // u8 n × [u8 slot, u8 flags, f32 x, f32 y, u8 state, u8 strokes, u8 k, k × u8 score]
  snapshot(w) {
    this.writePhase(w, this.playing ? HOLE_TIME_S - this.holeTime : undefined);
    w.u8(this.holeNo).u8(this.course.length).u8(this.holeIndex);
    w.u8(this.ents.length);
    for (const e of this.ents) {
      w.u8(e.player.slot).u8(ArcadeGame.flags(e.player)).f32(e.x).f32(e.y).u8(e.state).u8(e.strokes);
      const k = Math.min(e.scores.length, this.holeNo + 1);
      w.u8(k);
      for (let i = 0; i < k; i++) w.u8(e.scores[i] ?? 0);
    }
  }

  results() {
    const par = this.course.slice(0, this.holeNo + 1).reduce((sum, i) => sum + HOLES[i].par, 0);
    const sorted = [...this.ents].sort((a, b) => this.total(a) - this.total(b) || b.aces - a.aces);
    const vsPar = (n) => (n === 0 ? 'par' : n > 0 ? `+${n}` : String(n));
    return {
      title: 'Uitslag Minigolf',
      columns: ['Slagen', 'Tegen par', 'Hole-in-one'],
      rows: this.rows(sorted, (e) => [this.total(e), vsPar(this.total(e) - par), e.aces]),
    };
  }
}

export default {
  id: 'minigolf',
  realtime: true,
  create: (room, settings) => new MinigolfGame(room, settings),
};

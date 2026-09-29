// Raak de Roos (server side): an archery range with a lane and a target per
// player. Everyone shoots their three arrows of an end at the same time;
// the distance grows every end and the wind changes. The client sends the
// aim (yaw, pitch, draw and when it let go); the server flies the arrow and
// scores it. Optionally the targets slide from side to side.
import { createRng } from '../../shared/rng.js';
import { ARC, WIND_MAX, endDistances, flyArrow, ringScore, targetOffset } from '../../shared/games/archery.js';
import { planArrow, BOT_THINK_S } from './archery-bots.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const r3 = (v) => Math.round(v * 1000) / 1000;

class ArcheryGame {
  constructor(room, settings) {
    this.room = room;
    this.rng = createRng(settings.seed);
    this.ends = settings.ends ?? 5;
    this.windMax = WIND_MAX[settings.wind] ?? WIND_MAX.normaal;
    this.movingSetting = settings.moving ?? 'laatste';
    this.distances = endDistances(this.ends);
    this.archers = new Map();
    this.time = 0;
    this.end = 0;
    this.shotId = 0;
    this.wind = 0;
    for (const p of room.gamePlayers()) this.onJoin(p);
    this._newEnd();
  }

  // ---------------------------------------------------------------------------
  // Players
  // ---------------------------------------------------------------------------
  onJoin(player) {
    if (this.archers.has(player.id)) return;
    const used = new Set([...this.archers.values()].map((a) => a.lane));
    let lane = 0;
    while (used.has(lane) && lane < ARC.LANES - 1) lane++;
    this.archers.set(player.id, {
      player, lane, total: 0, xs: 0, tens: 0, scores: [], arrows: [],
      left: this.phase === 'shoot' || this.phase === 'intro' ? ARC.ARROWS : 0, nextAt: 0, botAt: 0,
    });
    this.dirty = true;
  }

  onLeave(player) {
    this.archers.delete(player.id);
    this._checkDone();
    this.dirty = true;
  }

  onBotTakeover() {
    this.dirty = true;
  }

  onReconnect() {
    this.dirty = true;
  }

  get endTime() {
    return this.time - this.endStart;
  }

  // ---------------------------------------------------------------------------
  // Ends
  // ---------------------------------------------------------------------------
  _newEnd() {
    this.end++;
    this.distance = this.distances[this.end - 1];
    const w = this.windMax;
    this.wind = w ? Math.round(clamp(this.wind * 0.3 + (this.rng() * 2 - 1) * w, -w, w) * 10) / 10 : 0;
    this.moving = this.movingSetting === 'altijd' || (this.movingSetting === 'laatste' && this.end > this.ends - 2 && this.ends > 1);
    for (const a of this.archers.values()) {
      a.arrows = [];
      a.left = ARC.ARROWS;
      a.nextAt = 0;
      a.botAt = 0;
    }
    this.phase = 'intro';
    this.phaseEnd = this.time + ARC.INTRO_S;
    this.endStart = this.time + ARC.INTRO_S;
    this.room.emit('round', { r: this.end });
    this.dirty = true;
  }

  // ---------------------------------------------------------------------------
  // Shooting
  // ---------------------------------------------------------------------------
  // data: { yaw, pitch, draw, t } (t = the end time when the client let go).
  onInput(player, data) {
    const a = this.archers.get(player.id);
    if (!a || !data || typeof data !== 'object') return;
    const { yaw, pitch, draw } = data;
    if (![yaw, pitch, draw].every(Number.isFinite)) return;
    const now = this.endTime;
    const t = Number.isFinite(data.t) ? clamp(data.t, now - ARC.TIME_SLACK_S, now) : now;
    this.shoot(a, yaw, pitch, draw, t);
  }

  // Returns the arrow, or null when this archer may not shoot now.
  shoot(a, yaw, pitch, draw, t = this.endTime) {
    if (this.phase !== 'shoot' || a.left <= 0 || this.time < a.nextAt) return null;
    yaw = clamp(yaw, -ARC.MAX_YAW, ARC.MAX_YAW);
    pitch = clamp(pitch, -ARC.MAX_PITCH, ARC.MAX_PITCH);
    draw = clamp(draw, ARC.MIN_DRAW, 1);
    const res = flyArrow(this.distance, yaw, pitch, draw, this.wind);
    const off = targetOffset(a.lane, t + res.t, this.moving);
    const dx = res.x - off;
    const dy = res.y - ARC.TARGET_H;
    const { score, x } = res.hit ? ringScore(dx, dy) : { score: 0, x: false };
    // Hits stick in the face (relative to its centre); misses in the straw
    // boss around it or in the grass.
    const arrow = score > 0 || (res.hit && Math.abs(dx) < 0.8 && res.y < 2.1)
      ? { ax: r3(dx), ay: r3(dy), s: score, x }
      : { ax: r3(dx), ay: r3(dy), s: 0, miss: true, gx: r3(res.x), gz: r3(res.z) };
    a.arrows.push(arrow);
    a.left--;
    a.nextAt = this.time + ARC.ARROW_GAP_S;
    a.total += score;
    if (x) a.xs++;
    if (score === 10) a.tens++;
    this.shotId++;
    this.room.emit('shot', {
      id: this.shotId, by: a.player.id, lane: a.lane, yaw: r3(yaw), pitch: r3(pitch), draw: r3(draw), t: r3(t), ...arrow,
    });
    this._checkDone();
    this.dirty = true;
    return arrow;
  }

  _checkDone() {
    if (this.phase !== 'shoot') return;
    if ([...this.archers.values()].every((a) => a.left <= 0)) this._score();
  }

  _score() {
    for (const a of this.archers.values()) {
      a.scores.push(a.arrows.reduce((n, r) => n + r.s, 0));
      a.left = 0;
    }
    this.phase = 'score';
    this.phaseEnd = this.time + ARC.SCORE_S;
    this.room.emit('endScore', { end: this.end });
    this.dirty = true;
  }

  // ---------------------------------------------------------------------------
  // Tick: timers and bots
  // ---------------------------------------------------------------------------
  tick(dt) {
    this.time += dt;
    if (this.phase === 'shoot') this._bots();
    if (this.time < this.phaseEnd) return;
    switch (this.phase) {
      case 'intro':
        this.phase = 'shoot';
        this.phaseEnd = this.time + ARC.SHOOT_S;
        this.room.emit('go');
        this.dirty = true;
        break;
      case 'shoot':
        this._score();
        break;
      case 'score':
        if (this.end >= this.ends) {
          this.phase = 'end';
          this.phaseEnd = this.time + ARC.END_HOLD_S;
          this.room.emit('end');
          this.dirty = true;
        } else this._newEnd();
        break;
      case 'end':
        this.phase = 'done';
        this.room.endGame(this.results());
        break;
      default:
    }
  }

  _bots() {
    for (const a of this.archers.values()) {
      if (!a.player.isBot || a.left <= 0 || this.time < a.nextAt) continue;
      const level = a.player.botLevel ?? 'normal';
      if (!a.botAt) a.botAt = this.time + (BOT_THINK_S[level] ?? 2) * (0.7 + this.rng() * 0.6);
      if (this.time < a.botAt) continue;
      a.botAt = 0;
      const plan = planArrow(this, a, level, this.rng);
      this.shoot(a, plan.yaw, plan.pitch, plan.draw);
    }
  }

  // ---------------------------------------------------------------------------
  // Output
  // ---------------------------------------------------------------------------
  snapshot() {
    return {
      phase: this.phase,
      left: Math.max(0, this.phaseEnd - this.time),
      t: Math.round(this.endTime * 1000) / 1000,
      end: this.end,
      ends: this.ends,
      distance: this.distance,
      wind: this.wind,
      moving: this.moving,
      archers: [...this.archers.values()].map((a) => ({
        id: a.player.id, lane: a.lane, left: a.left, total: a.total, xs: a.xs, scores: a.scores, arrows: a.arrows,
      })),
    };
  }

  results() {
    const list = [...this.archers.values()].sort((a, b) => b.total - a.total || b.xs - a.xs || b.tens - a.tens);
    return {
      title: 'Uitslag Raak de Roos',
      columns: ['Punten', 'Tienen', "X'en"],
      rows: list.map((a, i) => ({
        id: a.player.id, name: a.player.name, color: a.player.color, rank: i + 1,
        values: [String(a.total), String(a.tens), String(a.xs)],
      })),
    };
  }
}

export default {
  id: 'archery',
  realtime: false,
  create: (room, settings) => new ArcheryGame(room, settings),
};

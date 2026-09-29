// Kladderkoning (server side): everyone rolls paint over one big canvas; the
// most cells in your colour when the time is up wins. A dash into someone
// splashes your paint around them and stuns them for a moment. Movement is
// shared (predicted by the owner); painting is decided here.
//
// The grid (60 × 40 cells) reaches the clients in two ways: every snapshot
// carries the cells that changed in the last few ticks (so a resync or a
// skipped snapshot does not matter much) plus one strip of the grid in full,
// in turn, so every client is completely up to date within STRIPS snapshots.
import { ArcadeGame } from './arcade.js';
import { ARCADE_PHASE } from '../../shared/games/arcade.js';
import {
  KL, KL_CELLS, KL_FLAG, KL_MAPS, KL_SPAWNS, KL_POWER, KL_POWERS, KL_POWER_RULES as PR,
  createPainter, stepPainter, mapWalls, blockedCells, forCellsInDisc,
} from '../../shared/games/kladder.js';
import { BTN } from '../../shared/messages.js';
import { createKladderBot, stepKladderBot } from './kladder-bots.js';

export const STRIPS = 8; // the grid in 8 strips of 5 rows
const STRIP_CELLS = KL_CELLS / STRIPS;
const LOG_SIZE = 8192;
const DELTA_TICKS = 3; // changes of the last 3 ticks go in every snapshot
const MAX_DELTA = 1500;
const HIT_REACH = KL.RADIUS * 2 + 2;
const ds = (t) => Math.min(255, Math.ceil(Math.max(0, t) * 10));

class KladderGame extends ArcadeGame {
  constructor(room, settings) {
    super(room, settings, { countdown: 3, endHold: 5 });
    this.mapId = KL_MAPS[settings.map] ? settings.map : 'atelier';
    this.map = KL_MAPS[this.mapId];
    this.walls = mapWalls(this.map);
    this.blocked = blockedCells(this.map);
    this.paintable = KL_CELLS - this.blocked.reduce((a, b) => a + b, 0);
    this.grid = new Uint8Array(KL_CELLS); // 0 = blank, otherwise slot + 1
    this.counts = new Int32Array(257);
    this.logIdx = new Uint16Array(LOG_SIZE);
    this.logOwner = new Uint8Array(LOG_SIZE);
    this.logTick = new Uint32Array(LOG_SIZE);
    this.logHead = 0;
    this.logLen = 0;
    this.tickNo = 1;
    this.strip = 0;
    this.duration = settings.duration ?? 120;
    this.endsAt = this.phaseEnd + this.duration;
    this.powersOn = settings.powerups !== false;
    this.powers = []; // { id, type, x, y, age }
    this.powerTimer = PR.FIRST_S;
    this.nextPowerId = 1;
    this.addPlayers();
    this.ents.forEach((e, i) => this._place(e, i));
  }

  createEntity() {
    return { s: createPainter(), px: 0, py: 0, wide: 0, splashes: 0, bot: createKladderBot() };
  }

  onJoin(player) {
    super.onJoin(player);
    const e = this.ent(player.id);
    if (e && this.grid) this._place(e, this.ents.indexOf(e));
  }

  _place(e, i) {
    const sp = KL_SPAWNS[i % KL_SPAWNS.length];
    Object.assign(e.s, createPainter(Math.fround(sp.x), Math.fround(sp.y)));
    const mx = 240 - sp.x;
    const my = 160 - sp.y;
    const d = Math.hypot(mx, my) || 1;
    e.s.fx = Math.fround(mx / d);
    e.s.fy = Math.fround(my / d);
    e.px = e.s.x;
    e.py = e.s.y;
  }

  owner(e) {
    return e.player.slot + 1;
  }

  cellsOf(e) {
    return this.counts[this.owner(e)];
  }

  // ---------------------------------------------------------------------------
  step(dt) {
    if (this.time >= this.endsAt) {
      this.finish();
      return;
    }
    this.tickNo++;
    for (const e of this.ents) {
      e.px = e.s.x;
      e.py = e.s.y;
      if (e.wide > 0) e.wide = Math.max(0, e.wide - dt);
      if (e.player.isBot) {
        const b = stepKladderBot(e, this, dt, this.rng);
        stepPainter(e.s, b.ax, b.ay, b.a, dt, this.walls);
      } else {
        this.eachInput(e, (input) => stepPainter(e.s, input.ax, input.ay, input.buttons & BTN.A, dt, this.walls));
      }
    }
    for (const e of this.ents) if (e.s.stun <= 0) this._paintPath(e);
    this._dashHits();
    this._powers(dt);
  }

  // Paint along the whole path of this tick (a dash covers a lot of ground).
  _paintPath(e) {
    const r = e.wide > 0 ? KL.WIDE_BRUSH : KL.BRUSH;
    const dx = e.s.x - e.px;
    const dy = e.s.y - e.py;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (KL.CELL / 2)));
    for (let k = 1; k <= steps; k++) this.paintDisc(e.px + (dx * k) / steps, e.py + (dy * k) / steps, r, this.owner(e));
  }

  paintDisc(x, y, r, owner) {
    forCellsInDisc(x, y, r, (i) => {
      if (this.blocked[i] || this.grid[i] === owner) return;
      this.counts[this.grid[i]]--;
      this.counts[owner]++;
      this.grid[i] = owner;
      const at = (this.logHead + this.logLen) % LOG_SIZE;
      this.logIdx[at] = i;
      this.logOwner[at] = owner;
      this.logTick[at] = this.tickNo;
      if (this.logLen < LOG_SIZE) this.logLen++;
      else this.logHead = (this.logHead + 1) % LOG_SIZE;
    });
  }

  // A dashing painter that runs into someone splashes them.
  _dashHits() {
    for (const a of this.ents) {
      if (!(a.s.dash > 0)) continue;
      for (const b of this.ents) {
        if (b === a || b.s.stun > 0) continue;
        const dx = b.s.x - a.s.x;
        const dy = b.s.y - a.s.y;
        const d = Math.hypot(dx, dy);
        if (d > HIT_REACH) continue;
        const nx = d > 1e-6 ? dx / d : a.s.fx;
        const ny = d > 1e-6 ? dy / d : a.s.fy;
        b.s.stun = Math.fround(KL.STUN_S);
        b.s.dash = 0;
        b.s.vx = Math.fround(nx * 120);
        b.s.vy = Math.fround(ny * 120);
        a.s.dash = 0;
        a.s.vx = Math.fround(a.s.vx * 0.3);
        a.s.vy = Math.fround(a.s.vy * 0.3);
        a.splashes++;
        this.paintDisc(b.s.x, b.s.y, KL.SPLASH_R, this.owner(a));
        this.room.emit('splash', { s: a.player.slot, v: b.player.slot, x: Math.round(b.s.x), y: Math.round(b.s.y) });
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Power-ups
  // ---------------------------------------------------------------------------
  _powers(dt) {
    if (!this.powersOn) return;
    this.powerTimer -= dt;
    if (this.powerTimer <= 0) {
      const [lo, hi] = PR.EVERY_S;
      this.powerTimer = lo + this.rng() * (hi - lo);
      if (this.powers.length < PR.MAX) this.spawnPower();
    }
    for (let i = this.powers.length - 1; i >= 0; i--) {
      const p = this.powers[i];
      p.age += dt;
      if (p.age > PR.LIFE_S) {
        this.powers.splice(i, 1);
        continue;
      }
      const reach = KL.RADIUS + PR.RADIUS;
      const e = this.ents.find((o) => (o.s.x - p.x) ** 2 + (o.s.y - p.y) ** 2 <= reach * reach);
      if (!e) continue;
      this.applyPower(e, p.type);
      this.room.emit('power', { s: e.player.slot, type: p.type, x: Math.round(p.x), y: Math.round(p.y) });
      this.powers.splice(i, 1);
    }
  }

  // On a free cell, away from the painters.
  spawnPower(type = Math.floor(this.rng() * KL_POWERS.length)) {
    let best = null;
    let bestD = -1;
    for (let k = 0; k < 10; k++) {
      const i = Math.floor(this.rng() * KL_CELLS);
      if (this.blocked[i]) continue;
      const x = ((i % KL.COLS) + 0.5) * KL.CELL;
      const y = (Math.floor(i / KL.COLS) + 0.5) * KL.CELL;
      if (x < 16 || y < 16 || x > KL.COLS * KL.CELL - 16 || y > KL.ROWS * KL.CELL - 16) continue;
      let d = Infinity;
      for (const e of this.ents) d = Math.min(d, Math.hypot(e.s.x - x, e.s.y - y));
      if (d > bestD) { bestD = d; best = { x, y }; }
    }
    if (!best) return null;
    const p = { id: this.nextPowerId, type, x: best.x, y: best.y, age: 0 };
    this.nextPowerId = (this.nextPowerId % 255) + 1;
    this.powers.push(p);
    return p;
  }

  applyPower(e, type) {
    if (type === KL_POWER.WIDE) e.wide = KL_POWERS[type].seconds;
    else if (type === KL_POWER.TURBO) e.s.boost = Math.fround(KL_POWERS[type].seconds);
    else if (type === KL_POWER.BOMB) {
      this.paintDisc(e.s.x, e.s.y, KL.BOMB_R, this.owner(e));
      this.room.emit('bomb', { s: e.player.slot, x: Math.round(e.s.x), y: Math.round(e.s.y) });
    }
  }

  // ---------------------------------------------------------------------------
  // Snapshot + results
  // ---------------------------------------------------------------------------
  // Body: u8 phase, f32 seconds left, u8 map index,
  //   u8 n × [u8 slot, u8 flags, u16 ack, f32 x, y, vx, vy, fx, fy, dash, cool, boost, stun,
  //           u8 prevA, u16 cells, u8 wide (ds), u8 splashes]
  //   u8 m × [u8 id, u8 type, u16 x, u16 y]                       power-ups
  //   u16 k × [u16 cell, u8 owner]                                 recent changes, oldest first
  //   u8 strip, u16 runs × [u8 owner, u8 length]                   one strip of the grid in full
  snapshot(w) {
    const left = this.phase === ARCADE_PHASE.PLAY ? this.endsAt - this.time : this.phaseEnd - this.time;
    this.writePhase(w, left);
    w.u8(Object.keys(KL_MAPS).indexOf(this.mapId));
    w.u8(this.ents.length);
    for (const e of this.ents) {
      const s = e.s;
      const flags = ArcadeGame.flags(e.player) | (e.wide > 0 ? KL_FLAG.WIDE : 0) | (s.dash > 0 ? KL_FLAG.DASH : 0) | (s.stun > 0 ? KL_FLAG.STUN : 0);
      w.u8(e.player.slot).u8(flags).u16(e.queue.ackSeq);
      w.f32(s.x).f32(s.y).f32(s.vx).f32(s.vy).f32(s.fx).f32(s.fy).f32(s.dash).f32(s.cool).f32(s.boost).f32(s.stun).u8(s.prevA);
      w.u16(this.cellsOf(e)).u8(ds(e.wide)).u8(Math.min(255, e.splashes));
    }
    w.u8(this.powers.length);
    for (const p of this.powers) w.u8(p.id).u8(p.type).u16(Math.round(p.x)).u16(Math.round(p.y));
    // Recent changes.
    let n = 0;
    while (n < this.logLen && n < MAX_DELTA) {
      const at = (this.logHead + this.logLen - 1 - n) % LOG_SIZE;
      if (this.logTick[at] + DELTA_TICKS <= this.tickNo) break;
      n++;
    }
    w.u16(n);
    for (let k = n - 1; k >= 0; k--) {
      const at = (this.logHead + this.logLen - 1 - k) % LOG_SIZE;
      w.u16(this.logIdx[at]).u8(this.logOwner[at]);
    }
    // One strip in full (run-length encoded).
    const from = this.strip * STRIP_CELLS;
    this.strip = (this.strip + 1) % STRIPS;
    const runs = [];
    for (let i = from; i < from + STRIP_CELLS;) {
      const v = this.grid[i];
      let len = 1;
      while (len < 255 && i + len < from + STRIP_CELLS && this.grid[i + len] === v) len++;
      runs.push(v, len);
      i += len;
    }
    w.u8((from / STRIP_CELLS) | 0).u16(runs.length / 2);
    for (let k = 0; k < runs.length; k++) w.u8(runs[k]);
  }

  results() {
    const pct = (e) => Math.round((this.cellsOf(e) / this.paintable) * 1000) / 10;
    const sorted = [...this.ents].sort((a, b) => this.cellsOf(b) - this.cellsOf(a) || b.splashes - a.splashes);
    return {
      title: 'Uitslag Kladderkoning',
      columns: ['Geverfd', 'Spetters'],
      rows: this.rows(sorted, (e) => [`${pct(e)}%`, e.splashes]),
    };
  }
}

export default {
  id: 'kladder',
  realtime: true,
  create: (room, settings) => new KladderGame(room, settings),
};

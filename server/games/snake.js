// Slangenstrijd (server side): battle royale with snakes on a grid.
// Eat apples to grow, don't crash. Last snake alive wins the round.
import { ArcadeGame } from './arcade.js';
import {
  SNAKE_GRID as G, SNAKE_TICKS_PER_MOVE, SNAKE_START_LEN, SNAKE_GROW, DIRS, opposite, dirFromAxes, packBody,
} from '../../shared/games/snake.js';
import { botDirection } from './snake-bots.js';

const ROUND_END_S = 3;
const ROUND_MAX_S = 120; // then the longest surviving snake wins
const MAX_TURNS_QUEUED = 2;
// Start positions (x, y, dir), spread around the arena, facing inwards.
const SPAWNS = [[6, 6, 0], [45, 21, 2], [45, 6, 2], [6, 21, 0], [26, 3, 1], [26, 24, 3]];

class SnakeGame extends ArcadeGame {
  constructor(room, settings) {
    super(room, settings);
    this.rounds = settings.rounds ?? 3;
    this.round = 0;
    this.occ = new Int8Array(G.cols * G.rows); // -1 free, else slot
    this.addPlayers();
    this._newRound();
  }

  createEntity() {
    return { cells: [], dir: 0, turns: [], alive: false, grow: 0, points: 0, wins: 0, best: 0 };
  }

  onJoin(player) {
    super.onJoin(player);
    if (this.food) this.ent(player.id).alive = false; // late joiners wait for the next round
  }

  _newRound() {
    this.round++;
    this.startCountdown();
    this.ticks = 0;
    this.moves = 0;
    this.roundTime = 0;
    this.deadOrder = [];
    this.ents.forEach((e, i) => {
      const [x, y, d] = SPAWNS[i % SPAWNS.length];
      e.dir = d;
      e.turns = [];
      e.grow = 0;
      e.alive = true;
      e.cells = [];
      for (let k = 0; k < SNAKE_START_LEN; k++) e.cells.push([x - DIRS[d][0] * k, y - DIRS[d][1] * k]);
    });
    this.food = [];
    this._rebuildOcc();
    for (let i = 0; i < this.ents.length + 3; i++) this._spawnFood();
    this.room.emit('round', { r: this.round });
  }

  nextRound() {
    if (this.round >= this.rounds) this.finish();
    else this._newRound();
  }

  _rebuildOcc() {
    this.occ.fill(-1);
    for (const e of this.ents) {
      if (!e.alive) continue;
      for (const [x, y] of e.cells) this.occ[y * G.cols + x] = e.player.slot;
    }
  }

  _spawnFood() {
    for (let tries = 0; tries < 200; tries++) {
      const x = 1 + Math.floor(this.rng() * (G.cols - 2));
      const y = 1 + Math.floor(this.rng() * (G.rows - 2));
      if (this.occ[y * G.cols + x] !== -1 || this.food.some((f) => f[0] === x && f[1] === y)) continue;
      this.food.push([x, y]);
      return;
    }
  }

  _queueTurn(e, d) {
    const last = e.turns.length ? e.turns[e.turns.length - 1] : e.dir;
    if (d === last || d === opposite(last) || e.turns.length >= MAX_TURNS_QUEUED) return;
    e.turns.push(d);
  }

  step(dt) {
    this.roundTime += dt;
    for (const e of this.ents) {
      if (e.player.isBot) continue;
      this.eachInput(e, (inp) => {
        const d = dirFromAxes(inp.ax, inp.ay);
        if (d >= 0 && e.alive) this._queueTurn(e, d);
      });
    }
    this.ticks++;
    if (this.ticks % SNAKE_TICKS_PER_MOVE !== 0) return;
    this._move();
    const alive = this.ents.filter((e) => e.alive);
    const solo = this.ents.length === 1;
    if ((solo && !alive.length) || (!solo && alive.length <= 1) || this.roundTime > ROUND_MAX_S) this._endRound(alive);
  }

  _move() {
    this.moves++;
    const alive = this.ents.filter((e) => e.alive);
    for (const e of alive) {
      if (e.player.isBot) {
        const d = botDirection(e, this);
        if (d >= 0 && d !== opposite(e.dir)) e.dir = d;
      } else if (e.turns.length) {
        e.dir = e.turns.shift();
      }
    }
    // Tails that move away this step are free to enter.
    const heads = new Map();
    for (const e of alive) {
      const [hx, hy] = e.cells[0];
      const nx = hx + DIRS[e.dir][0];
      const ny = hy + DIRS[e.dir][1];
      e.next = [nx, ny];
      const key = ny * G.cols + nx;
      heads.set(key, (heads.get(key) ?? 0) + 1);
      if (!e.grow) {
        const [tx, ty] = e.cells[e.cells.length - 1];
        this.occ[ty * G.cols + tx] = -1;
      }
    }
    const died = [];
    for (const e of alive) {
      const [nx, ny] = e.next;
      const out = nx < 0 || ny < 0 || nx >= G.cols || ny >= G.rows;
      const key = ny * G.cols + nx;
      if (out || this.occ[key] !== -1 || heads.get(key) > 1) died.push(e);
    }
    for (const e of alive) {
      if (died.includes(e)) continue;
      e.cells.unshift(e.next);
      if (e.grow > 0) e.grow--;
      else e.cells.pop();
      const fi = this.food.findIndex((f) => f[0] === e.next[0] && f[1] === e.next[1]);
      if (fi >= 0) {
        this.food.splice(fi, 1);
        e.grow += SNAKE_GROW;
        this.room.emit('eat', { s: e.player.slot, x: e.next[0], y: e.next[1] });
      }
      e.best = Math.max(e.best, e.cells.length + e.grow);
    }
    for (const e of died) this._kill(e);
    this._rebuildOcc();
    while (this.food.length < alive.length + 2 && this.food.length < 40) this._spawnFood();
  }

  _kill(e) {
    e.alive = false;
    this.deadOrder.push(e);
    const [hx, hy] = e.cells[0];
    this.room.emit('die', { s: e.player.slot, x: hx, y: hy });
    // The body turns into apples.
    for (let i = 2; i < e.cells.length; i += 3) {
      const [x, y] = e.cells[i];
      if (!this.food.some((f) => f[0] === x && f[1] === y) && this.food.length < 60) this.food.push([x, y]);
    }
  }

  _endRound(alive) {
    // Ranking this round: survivors (longest first), then the dead (last to die first).
    const order = [...alive.sort((a, b) => b.cells.length - a.cells.length), ...[...this.deadOrder].reverse()];
    const n = order.length;
    order.forEach((e, i) => { e.points += n - 1 - i; });
    const winner = order[0] ?? null;
    if (winner && (alive.length || this.ents.length === 1)) winner.wins++;
    this.endRound(ROUND_END_S, { s: winner ? winner.player.slot : -1, r: this.round });
  }

  // Body layout (after the header): u8 phase, f32 left, u8 round, u8 rounds, u16 moves,
  // u8 n × [u8 slot, u8 flags, u8 alive, u8 dir, u16 len, u16 points, u8 wins, u8 hx, u8 hy, packed body],
  // u8 food × [u8 x, u8 y]
  snapshot(w) {
    this.writePhase(w, this.playing ? ROUND_MAX_S - this.roundTime : this.phaseEnd - this.time);
    w.u8(this.round).u8(this.rounds).u16(this.moves & 0xffff);
    w.u8(this.ents.length);
    for (const e of this.ents) {
      w.u8(e.player.slot).u8(ArcadeGame.flags(e.player)).u8(e.alive ? 1 : 0).u8(e.dir);
      const cells = e.cells.length ? e.cells : [[0, 0]];
      w.u16(cells.length).u16(e.points).u8(e.wins).u8(cells[0][0]).u8(cells[0][1]);
      for (const b of packBody(cells)) w.u8(b);
    }
    w.u8(this.food.length);
    for (const [x, y] of this.food) w.u8(x).u8(y);
  }

  results() {
    const sorted = [...this.ents].sort((a, b) => b.points - a.points || b.wins - a.wins || b.best - a.best);
    return {
      title: 'Uitslag Slangenstrijd',
      columns: ['Punten', 'Rondes gewonnen', 'Langste'],
      rows: this.rows(sorted, (e) => [e.points, e.wins, e.best]),
    };
  }
}

export default {
  id: 'snake',
  realtime: true,
  create: (room, settings) => new SnakeGame(room, settings),
};

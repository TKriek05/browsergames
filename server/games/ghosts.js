// Spookjesdoolhof (server side): co-op maze chase. Everyone eats dots
// together; four ghosts hunt the players, each with its own way of choosing
// a target; power pellets turn the tables for a while.
import { ArcadeGame } from './arcade.js';
import {
  MAZE, MAZE_W, MAZE_H, TUNNEL_ROW, UNIT, PLAYER_SPEED, DIRS, opposite, open, stepMover, tileOf, GHOST_MODE as M,
} from '../../shared/games/ghosts.js';
import { dirFromAxes } from '../../shared/games/snake.js';

const LEVEL_PAUSE_S = 2.5;
const RESPAWN_S = 2.5;
const FRIGHT_S = [7, 6, 5, 4, 3, 3, 2];
const MODE_TIMES = [7, 20, 7, 20, 5, 20, 5, Infinity]; // scatter, chase, …
const RELEASE_S = [0, 3, 6, 9];
const FRUIT_AT = [60, 130]; // dots eaten
const FRUIT_S = 9;
const CORNERS = [[25, -2], [1, -2], [26, 23], [0, 23]];
const EAT_REACH = 8; // units

class GhostsGame extends ArcadeGame {
  constructor(room, settings) {
    super(room, settings);
    this.level = 0;
    this.addPlayers();
    this.lives = 3 + this.ents.length;
    this._startLevel();
  }

  createEntity() {
    return { s: { x: 0, y: 0, dir: 2, want: -1 }, alive: true, respawn: 0, score: 0, dots: 0, eaten: 0, plan: -1 };
  }

  _startLevel() {
    this.level++;
    this.dots = MAZE.dots.slice();
    this.dotsLeft = this.dots.reduce((a, v) => a + (v ? 1 : 0), 0);
    this.dotsEaten = 0;
    this.fright = 0;
    this.chain = 0;
    this.modeIndex = 0;
    this.modeT = MODE_TIMES[0];
    this.fruit = 0;
    this.ghosts = MAZE.ghostStarts.map((g, i) => ({
      i, x: g.x * UNIT, y: g.y * UNIT, dir: 3, mode: M.HOUSE, leaving: false,
      release: RELEASE_S[i] / Math.min(2, 1 + (this.level - 1) * 0.25), acc: 0,
    }));
    this.ents.forEach((e, i) => this._placePlayer(e, i));
    this.startCountdown(this.level === 1 ? 3 : 2);
    this.room.emit('level', { n: this.level });
  }

  nextRound() {
    this._startLevel();
  }

  _placePlayer(e, i) {
    const st = MAZE.playerStarts[i % MAZE.playerStarts.length];
    e.s.x = st.x * UNIT;
    e.s.y = st.y * UNIT;
    e.s.dir = i % 2 ? 0 : 2;
    e.s.want = -1;
    e.alive = true;
  }

  get chasing() {
    return this.modeIndex % 2 === 1;
  }

  step(dt) {
    // Scatter/chase rhythm (paused while the ghosts are frightened).
    if (this.fright > 0) {
      this.fright -= dt;
      if (this.fright <= 0) {
        this.fright = 0;
        for (const g of this.ghosts) if (g.mode === M.FRIGHT) g.mode = this.chasing ? M.CHASE : M.SCATTER;
      }
    } else {
      this.modeT -= dt;
      if (this.modeT <= 0 && this.modeIndex < MODE_TIMES.length - 1) {
        this.modeIndex++;
        this.modeT = MODE_TIMES[this.modeIndex];
        for (const g of this.ghosts) {
          if (g.mode === M.SCATTER || g.mode === M.CHASE) {
            g.mode = this.chasing ? M.CHASE : M.SCATTER;
            g.dir = opposite(g.dir); // the classic "they all turn around"
          }
        }
      }
    }

    for (const e of this.ents) {
      if (!e.alive) {
        if (!e.player.isBot) this.eachInput(e, () => {});
        e.respawn -= dt;
        if (e.respawn <= 0 && this.lives > 0) {
          this._placePlayer(e, this.ents.indexOf(e));
          this.room.emit('spawn', { s: e.player.slot });
        }
        continue;
      }
      if (e.player.isBot) {
        this._bot(e);
        stepMover(e.s, PLAYER_SPEED);
      } else {
        this.eachInput(e, (inp) => {
          const d = dirFromAxes(inp.ax, inp.ay);
          if (d >= 0) e.s.want = d;
          stepMover(e.s, PLAYER_SPEED);
        });
      }
      this._eat(e);
    }
    if (this.fruit > 0) this.fruit = Math.max(0, this.fruit - dt);
    for (const g of this.ghosts) this._stepGhost(g, dt);
    this._collide();

    if (this.dotsLeft <= 0) this.endRound(LEVEL_PAUSE_S, { level: this.level });
    else if (this.lives <= 0 && !this.ents.some((e) => e.alive)) this.finish({});
  }

  _eat(e) {
    const tx = tileOf(e.s.x);
    const ty = tileOf(e.s.y);
    if (tx < 0 || tx >= MAZE_W || ty < 0 || ty >= MAZE_H) return;
    const i = ty * MAZE_W + tx;
    const d = this.dots[i];
    if (d) {
      this.dots[i] = 0;
      this.dotsLeft--;
      this.dotsEaten++;
      e.dots++;
      e.score += d === 2 ? 50 : 10;
      if (d === 2) this._frighten();
      if (FRUIT_AT.includes(this.dotsEaten)) {
        this.fruit = FRUIT_S;
        this.room.emit('fruitOn');
      }
    }
    // Fruit sits just below the ghost house.
    if (this.fruit > 0 && tx === 13 && ty === 13) {
      const p = 100 * this.level;
      e.score += p;
      this.fruit = 0;
      this.room.emit('fruit', { s: e.player.slot, p });
    }
  }

  _frighten() {
    this.fright = FRIGHT_S[Math.min(this.level - 1, FRIGHT_S.length - 1)];
    this.chain = 0;
    for (const g of this.ghosts) {
      if (g.mode === M.SCATTER || g.mode === M.CHASE) {
        g.mode = M.FRIGHT;
        g.dir = opposite(g.dir);
      }
    }
    this.room.emit('power');
  }

  _stepGhost(g, dt) {
    if (g.mode === M.HOUSE) {
      g.release -= dt;
      if (g.release > 0) return;
      g.mode = M.SCATTER + (this.chasing ? 1 : 0);
      g.leaving = true;
    }
    let speed;
    if (g.mode === M.EYES) speed = 4;
    else if (g.mode === M.FRIGHT) speed = 1.1;
    else speed = Math.min(2.1, 1.75 + (this.level - 1) * 0.06);
    if (g.y === TUNNEL_ROW * UNIT && (g.x < 5 * UNIT || g.x > (MAZE_W - 6) * UNIT)) speed = Math.min(speed, 1);
    g.acc += speed;
    const steps = Math.floor(g.acc);
    g.acc -= steps;
    for (let n = 0; n < steps; n++) {
      if (g.x % UNIT === 0 && g.y % UNIT === 0) this._chooseDir(g);
      if (g.dir < 0) return;
      g.x += DIRS[g.dir][0];
      g.y += DIRS[g.dir][1];
      if (g.x < -UNIT) g.x += (MAZE_W + 1) * UNIT;
      if (g.x > MAZE_W * UNIT) g.x -= (MAZE_W + 1) * UNIT;
      // Eyes that reach the house become a ghost again.
      if (g.mode === M.EYES && g.x === MAZE.door.x * UNIT && g.y === (MAZE.door.y + 1) * UNIT) {
        g.mode = this.chasing ? M.CHASE : M.SCATTER;
        g.leaving = true;
      }
      if (g.leaving && g.y <= (MAZE.door.y - 1) * UNIT) g.leaving = false;
    }
  }

  // At a tile centre: pick the open direction that gets closest to the target
  // (no reversing), or a random one when frightened.
  _chooseDir(g) {
    const tx = g.x / UNIT;
    const ty = g.y / UNIT;
    const canDoor = g.mode === M.EYES || g.leaving;
    const options = [];
    for (const d of [3, 2, 1, 0]) {
      if (d === opposite(g.dir) && g.dir >= 0) continue;
      if (open(tx + DIRS[d][0], ty + DIRS[d][1], canDoor)) options.push(d);
    }
    if (!options.length) {
      g.dir = opposite(g.dir);
      return;
    }
    if (g.mode === M.FRIGHT) {
      g.dir = options[Math.floor(this.rng() * options.length)];
      return;
    }
    const [gx, gy] = this._target(g);
    let best = options[0];
    let bestD = Infinity;
    for (const d of options) {
      const dx = tx + DIRS[d][0] - gx;
      const dy = ty + DIRS[d][1] - gy;
      const dist = dx * dx + dy * dy;
      if (dist < bestD) { bestD = dist; best = d; }
    }
    g.dir = best;
  }

  _target(g) {
    if (g.mode === M.EYES) return [MAZE.door.x, MAZE.door.y + 1];
    if (g.leaving) return [MAZE.door.x, MAZE.door.y - 2];
    if (g.mode === M.SCATTER) return CORNERS[g.i];
    const p = this._nearestPlayer(g);
    if (!p) return CORNERS[g.i];
    const px = tileOf(p.s.x);
    const py = tileOf(p.s.y);
    const [dx, dy] = p.s.dir >= 0 ? DIRS[p.s.dir] : [0, 0];
    switch (g.i) {
      case 0: return [px, py]; // straight at you
      case 1: return [px + dx * 4, py + dy * 4]; // cuts you off
      case 2: { // pincer with the first ghost
        const a = this.ghosts[0];
        const mx = px + dx * 2;
        const my = py + dy * 2;
        return [mx * 2 - a.x / UNIT, my * 2 - a.y / UNIT];
      }
      default: { // shy: chases from afar, backs off when close
        const far = (tileOf(g.x) - px) ** 2 + (tileOf(g.y) - py) ** 2 > 64;
        return far ? [px, py] : CORNERS[3];
      }
    }
  }

  _nearestPlayer(g) {
    let best = null;
    let bestD = Infinity;
    for (const e of this.ents) {
      if (!e.alive) continue;
      const d = (e.s.x - g.x) ** 2 + (e.s.y - g.y) ** 2;
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  _collide() {
    for (const e of this.ents) {
      if (!e.alive) continue;
      for (const g of this.ghosts) {
        if (g.mode === M.EYES || g.mode === M.HOUSE) continue;
        if (Math.abs(g.x - e.s.x) >= EAT_REACH || Math.abs(g.y - e.s.y) >= EAT_REACH) continue;
        if (g.mode === M.FRIGHT) {
          this.chain++;
          const p = 200 * 2 ** Math.min(3, this.chain - 1);
          e.score += p;
          e.eaten++;
          g.mode = M.EYES;
          this.room.emit('eatGhost', { s: e.player.slot, p, x: g.x, y: g.y });
        } else {
          e.alive = false;
          e.respawn = RESPAWN_S;
          this.lives--;
          this.room.emit('die', { s: e.player.slot, x: e.s.x, y: e.s.y });
          break;
        }
      }
    }
  }

  // Bots: flee from nearby ghosts, hunt frightened ones, otherwise head for
  // the nearest dot (breadth-first over tiles).
  _bot(e) {
    const s = e.s;
    if (s.x % UNIT !== 0 || s.y % UNIT !== 0) return;
    const tx = s.x / UNIT;
    const ty = s.y / UNIT;
    const level = e.player.botLevel ?? 'normal';
    const sight = level === 'easy' ? 2 : level === 'hard' ? 5 : 3;
    let danger = null;
    for (const g of this.ghosts) {
      if (g.mode !== M.SCATTER && g.mode !== M.CHASE) continue;
      const d = Math.abs(tileOf(g.x) - tx) + Math.abs(tileOf(g.y) - ty);
      if (d <= sight && (!danger || d < danger.d)) danger = { g, d };
    }
    const options = [0, 1, 2, 3].filter((d) => open(tx + DIRS[d][0], ty + DIRS[d][1]));
    if (danger) {
      let best = options[0];
      let bestD = -1;
      for (const d of options) {
        const nx = tx + DIRS[d][0];
        const ny = ty + DIRS[d][1];
        const dist = (nx - tileOf(danger.g.x)) ** 2 + (ny - tileOf(danger.g.y)) ** 2;
        if (dist > bestD) { bestD = dist; best = d; }
      }
      s.want = best;
      return;
    }
    const wanted = (x, y) => {
      if (this.fright > 1.5 && level !== 'easy') {
        for (const g of this.ghosts) if (g.mode === M.FRIGHT && tileOf(g.x) === x && tileOf(g.y) === y) return true;
      }
      return this.dots[y * MAZE_W + x] > 0;
    };
    s.want = firstStep(tx, ty, wanted, options) ?? options[Math.floor(this.rng() * options.length)] ?? -1;
  }

  // Body: u8 phase, f32 left, u8 level, u8 lives, u8 fright(ds), u8 fruit,
  // u8 n × [u8 slot, u8 flags, u16 ack, i16 x, i16 y, i8 dir, i8 want, u8 alive, u16 score],
  // 4 × [i16 x, i16 y, i8 dir, u8 mode], dots: 2 bits per tile
  snapshot(w) {
    this.writePhase(w);
    w.u8(this.level).u8(Math.max(0, this.lives)).u8(Math.min(255, Math.ceil(this.fright * 10))).u8(this.fruit > 0 ? 1 : 0);
    w.u8(this.ents.length);
    for (const e of this.ents) {
      w.u8(e.player.slot).u8(ArcadeGame.flags(e.player)).u16(e.queue.ackSeq);
      w.i16(e.s.x).i16(e.s.y).i8(e.s.dir).i8(e.s.want).u8(e.alive ? 1 : 0).u16(Math.min(65535, e.score));
    }
    for (const g of this.ghosts) w.i16(g.x).i16(g.y).i8(g.dir).u8(g.mode);
    for (let i = 0; i < this.dots.length; i += 4) {
      let v = 0;
      for (let k = 0; k < 4 && i + k < this.dots.length; k++) v |= this.dots[i + k] << (k * 2);
      w.u8(v);
    }
  }

  results() {
    const sorted = [...this.ents].sort((a, b) => b.score - a.score);
    return {
      title: `Spookjesdoolhof: tot level ${this.level} gekomen`,
      columns: ['Punten', 'Stipjes', 'Spoken'],
      rows: this.rows(sorted, (e) => [e.score, e.dots, e.eaten]),
    };
  }
}

// Breadth-first search: the first direction towards the nearest wanted tile.
function firstStep(sx, sy, wanted, startDirs) {
  const seen = new Uint8Array(MAZE_W * MAZE_H);
  const queue = [];
  for (const d of startDirs) {
    let nx = sx + DIRS[d][0];
    const ny = sy + DIRS[d][1];
    if (nx < 0) nx = MAZE_W - 1;
    if (nx >= MAZE_W) nx = 0;
    queue.push([nx, ny, d]);
    seen[ny * MAZE_W + nx] = 1;
  }
  seen[sy * MAZE_W + sx] = 1;
  for (let h = 0; h < queue.length; h++) {
    const [x, y, first] = queue[h];
    if (wanted(x, y)) return first;
    for (const [dx, dy] of DIRS) {
      let nx = x + dx;
      const ny = y + dy;
      if (nx < 0) nx = MAZE_W - 1;
      if (nx >= MAZE_W) nx = 0;
      if (ny < 0 || ny >= MAZE_H || seen[ny * MAZE_W + nx] || !open(nx, ny)) continue;
      seen[ny * MAZE_W + nx] = 1;
      queue.push([nx, ny, first]);
    }
  }
  return null;
}

export default {
  id: 'ghosts',
  realtime: true,
  create: (room, settings) => new GhostsGame(room, settings),
};

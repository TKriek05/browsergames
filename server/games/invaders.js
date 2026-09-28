// Ruimtegolf (server side): co-op space invaders. The formation marches,
// speeds up as it shrinks and drops bombs; bunkers wear away; a saucer
// flies by now and then. The team shares its lives.
import { ArcadeGame } from './arcade.js';
import { BTN } from '../../shared/messages.js';
import { INV, ALIEN_POINTS, bunkerShape, bunkerX, stepShip } from '../../shared/games/invaders.js';

const SHOT_SPEED = 230;
const FIRE_COOLDOWN_S = 0.4;
const MAX_SHOTS = 2; // per ship
const RESPAWN_S = 2;
const INVULNERABLE_S = 2;
const UFO_EVERY_S = [18, 30];
const WAVE_PAUSE_S = 2.5;

const BOT = {
  easy: { replan: 0.6, fire: 0.5, dodge: 0 },
  normal: { replan: 0.3, fire: 0.8, dodge: 0.6 },
  hard: { replan: 0.12, fire: 1, dodge: 1 },
};

class InvadersGame extends ArcadeGame {
  constructor(room, settings) {
    super(room, settings);
    this.wavesMax = settings.waves ?? 5;
    this.wave = 0;
    this.shots = [];
    this.bombs = [];
    this.bunkers = [];
    this.addPlayers();
    this.lives = 3 + this.ents.length;
    this._startWave();
  }

  createEntity() {
    return { s: { p: 160 }, alive: true, respawn: 0, inv: 0, cooldown: 0, score: 0, kills: 0, target: 160, planIn: 0 };
  }

  _startWave() {
    this.wave++;
    this.aliens = new Uint8Array(INV.cols * INV.rows).fill(1);
    this.fx = 20;
    this.fy = 24 + Math.min(this.wave - 1, 5) * 4;
    this.dir = 1;
    this.stepT = 0.5;
    this.frame = 0;
    this.bombT = 1.5;
    this.shots.length = 0;
    this.bombs.length = 0;
    this.ufo = null;
    this.ufoIn = UFO_EVERY_S[0] + this.rng() * (UFO_EVERY_S[1] - UFO_EVERY_S[0]);
    if (this.wave === 1 || this.wave % 3 === 1) this.bunkers = Array.from({ length: INV.bunkers }, () => bunkerShape());
    this.ents.forEach((e, i) => {
      e.s.p = ((i + 1) * INV.width) / (this.ents.length + 1);
      e.alive = true;
      e.inv = 1;
    });
    this.startCountdown(this.wave === 1 ? 3 : 2);
    this.room.emit('wave', { n: this.wave });
  }

  nextRound() {
    this._startWave();
  }

  alienX(col) { return this.fx + col * INV.dx; }
  alienY(row) { return this.fy + row * INV.dy; }

  _remaining() {
    let n = 0;
    for (const a of this.aliens) n += a;
    return n;
  }

  step(dt) {
    for (const e of this.ents) {
      e.cooldown = Math.max(0, e.cooldown - dt);
      e.inv = Math.max(0, e.inv - dt);
      if (!e.alive) {
        e.respawn -= dt;
        if (e.respawn <= 0 && this.lives > 0) {
          e.alive = true;
          e.inv = INVULNERABLE_S;
        }
      }
      if (e.player.isBot) this._bot(e, dt);
      else this.eachInput(e, (inp) => {
        if (!e.alive) return;
        stepShip(e.s, inp.ax, dt);
        if (inp.buttons & BTN.A) this._fire(e);
      });
    }
    this._stepFormation(dt);
    this._stepUfo(dt);
    this._stepShots(dt);
    this._stepBombs(dt);

    if (!this._remaining()) {
      if (this.wavesMax && this.wave >= this.wavesMax) this.finish({ win: true });
      else this.endRound(WAVE_PAUSE_S, { wave: this.wave });
    } else if (this.lives <= 0) {
      this.finish({ win: false });
    }
  }

  _fire(e) {
    if (!e.alive || e.cooldown > 0) return;
    let mine = 0;
    for (const s of this.shots) if (s.owner === e) mine++;
    if (mine >= MAX_SHOTS) return;
    e.cooldown = FIRE_COOLDOWN_S;
    this.shots.push({ x: e.s.p, y: INV.shipY - 4, owner: e });
    this.room.emit('shoot', { s: e.player.slot });
  }

  _stepFormation(dt) {
    this.stepT -= dt;
    if (this.stepT > 0) return;
    const left = this._remaining();
    this.stepT = (0.04 + (0.55 * left) / (INV.cols * INV.rows)) / (1 + 0.12 * (this.wave - 1));
    this.frame ^= 1;
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < this.aliens.length; i++) {
      if (!this.aliens[i]) continue;
      const x = this.alienX(i % INV.cols);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + INV.alienW);
      maxY = Math.max(maxY, this.alienY(Math.floor(i / INV.cols)) + INV.alienH);
    }
    const nx = this.dir * 3;
    if (minX + nx < 4 || maxX + nx > INV.width - 4) {
      this.fy += 6;
      this.dir = -this.dir;
      maxY += 6;
    } else this.fx += nx;
    // Aliens chew through bunkers they touch.
    for (let i = 0; i < this.aliens.length; i++) {
      if (!this.aliens[i]) continue;
      const x = this.alienX(i % INV.cols);
      const y = this.alienY(Math.floor(i / INV.cols));
      for (let k = 0; k < INV.bunkers; k++) this._eraseBunker(k, x, y, INV.alienW, INV.alienH);
    }
    if (maxY >= INV.landY) this.lives = 0; // invasion
  }

  _stepUfo(dt) {
    if (this.ufo) {
      this.ufo.x += this.ufo.v * dt;
      if (this.ufo.x < -20 || this.ufo.x > INV.width + 20) this.ufo = null;
    } else {
      this.ufoIn -= dt;
      if (this.ufoIn <= 0) {
        this.ufoIn = UFO_EVERY_S[0] + this.rng() * (UFO_EVERY_S[1] - UFO_EVERY_S[0]);
        const fromLeft = this.rng() < 0.5;
        this.ufo = { x: fromLeft ? -16 : INV.width + 16, v: fromLeft ? 48 : -48 };
        this.room.emit('ufo');
      }
    }
  }

  _stepShots(dt) {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.y -= SHOT_SPEED * dt;
      let hit = s.y < INV.top;
      if (!hit) hit = this._shotHitsAlien(s);
      if (!hit && this.ufo && Math.abs(s.x - this.ufo.x) < 9 && Math.abs(s.y - 17) < 5) {
        const points = [100, 150, 200, 300][Math.floor(this.rng() * 4)];
        s.owner.score += points;
        this.room.emit('ufoHit', { x: Math.round(this.ufo.x), p: points, s: s.owner.player.slot });
        this.ufo = null;
        hit = true;
      }
      if (!hit) for (let k = 0; k < INV.bunkers && !hit; k++) hit = this._eraseBunker(k, s.x - 1, s.y - 2, 2, 4);
      if (!hit) {
        for (let j = this.bombs.length - 1; j >= 0; j--) {
          const b = this.bombs[j];
          if (Math.abs(b.x - s.x) < 3 && Math.abs(b.y - s.y) < 5) {
            this.bombs.splice(j, 1);
            hit = true;
            break;
          }
        }
      }
      if (hit) this.shots.splice(i, 1);
    }
  }

  _shotHitsAlien(s) {
    const col = Math.floor((s.x - this.fx) / INV.dx);
    const row = Math.floor((s.y - this.fy) / INV.dy);
    if (col < 0 || row < 0 || col >= INV.cols || row >= INV.rows) return false;
    const i = row * INV.cols + col;
    if (!this.aliens[i]) return false;
    if (s.x - this.alienX(col) > INV.alienW || s.y - this.alienY(row) > INV.alienH) return false;
    this.aliens[i] = 0;
    s.owner.score += ALIEN_POINTS[row];
    s.owner.kills++;
    this.room.emit('kill', { x: Math.round(this.alienX(col) + INV.alienW / 2), y: Math.round(this.alienY(row) + INV.alienH / 2), s: s.owner.player.slot, row });
    return true;
  }

  _stepBombs(dt) {
    // Bombs from the lowest alien of a random column.
    this.bombT -= dt;
    if (this.bombT <= 0) {
      const players = Math.max(1, this.ents.length);
      this.bombT = Math.max(0.35, 1.6 - this.wave * 0.1) / Math.sqrt(players);
      const cols = [];
      for (let c = 0; c < INV.cols; c++) {
        for (let r = INV.rows - 1; r >= 0; r--) {
          if (this.aliens[r * INV.cols + c]) { cols.push([c, r]); break; }
        }
      }
      if (cols.length) {
        const [c, r] = cols[Math.floor(this.rng() * cols.length)];
        this.bombs.push({ x: this.alienX(c) + INV.alienW / 2, y: this.alienY(r) + INV.alienH, v: 55 + this.wave * 5 });
      }
    }
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.y += b.v * dt;
      let hit = b.y > INV.height;
      for (let k = 0; k < INV.bunkers && !hit; k++) hit = this._eraseBunker(k, b.x - 2, b.y - 2, 4, 5);
      if (!hit) {
        for (const e of this.ents) {
          if (!e.alive || e.inv > 0) continue;
          if (Math.abs(b.x - e.s.p) < 6 && b.y > INV.shipY - 4 && b.y < INV.shipY + 5) {
            e.alive = false;
            e.respawn = RESPAWN_S;
            this.lives--;
            this.room.emit('shipHit', { s: e.player.slot, x: Math.round(e.s.p) });
            hit = true;
            break;
          }
        }
      }
      if (hit) this.bombs.splice(i, 1);
    }
  }

  // Remove bunker cells overlapping a rectangle. Returns true when any were hit.
  _eraseBunker(k, x, y, w, h) {
    const bx = bunkerX(k);
    const cells = this.bunkers[k];
    if (!cells || x + w < bx || x > bx + INV.bunkerCols * 2 || y + h < INV.bunkerY || y > INV.bunkerY + INV.bunkerRows * 2) return false;
    let hit = false;
    for (let r = 0; r < INV.bunkerRows; r++) {
      for (let c = 0; c < INV.bunkerCols; c++) {
        const i = r * INV.bunkerCols + c;
        if (!cells[i]) continue;
        const cx = bx + c * 2;
        const cy = INV.bunkerY + r * 2;
        if (cx + 2 <= x || cx >= x + w || cy + 2 <= y || cy >= y + h) continue;
        cells[i] = 0;
        hit = true;
      }
    }
    return hit;
  }

  _bot(e, dt) {
    const cfg = BOT[e.player.botLevel] ?? BOT.normal;
    if (!e.alive) return;
    e.planIn -= dt;
    if (e.planIn <= 0) {
      e.planIn = cfg.replan;
      // Aim under the nearest column that still has aliens.
      let best = e.s.p;
      let bestD = Infinity;
      for (let c = 0; c < INV.cols; c++) {
        let has = false;
        for (let r = 0; r < INV.rows; r++) if (this.aliens[r * INV.cols + c]) has = true;
        if (!has) continue;
        const x = this.alienX(c) + INV.alienW / 2 + this.dir * 4;
        const d = Math.abs(x - e.s.p);
        if (d < bestD) { bestD = d; best = x; }
      }
      e.target = best;
    }
    let target = e.target;
    if (this.rng() < cfg.dodge) {
      for (const b of this.bombs) {
        if (b.y > INV.shipY - 60 && b.y < INV.shipY + 2 && Math.abs(b.x - e.s.p) < 11) {
          const away = b.x > e.s.p ? -1 : 1;
          const edge = e.s.p + away * 24 < 10 || e.s.p + away * 24 > INV.width - 10;
          target = e.s.p + (edge ? -away : away) * 24;
          break;
        }
      }
    }
    const diff = target - e.s.p;
    stepShip(e.s, Math.abs(diff) < 1 ? 0 : Math.max(-1, Math.min(1, diff / 6)), dt);
    if (Math.abs(e.target - e.s.p) < 5 && this.rng() < cfg.fire) this._fire(e);
  }

  // Body: u8 phase, f32 left, u8 wave, u8 wavesMax, u8 lives, f32 fx, f32 fy, u8 frame,
  // alive bits (7 bytes), u8 n × [u8 slot, u8 flags, u16 ack, f32 p, u8 state, u16 score],
  // u8 shots × [i16 x*4, i16 y*4, u8 slot], u8 bombs × [i16 x*4, i16 y*4],
  // bunkers × 12 bytes of bits, i16 ufo x*4 (-32768 = none)
  snapshot(w) {
    this.writePhase(w);
    w.u8(this.wave).u8(this.wavesMax).u8(Math.max(0, this.lives)).f32(this.fx).f32(this.fy).u8(this.frame);
    for (let b = 0; b < 7; b++) {
      let v = 0;
      for (let k = 0; k < 8; k++) if (this.aliens[b * 8 + k]) v |= 1 << k;
      w.u8(v);
    }
    w.u8(this.ents.length);
    for (const e of this.ents) {
      w.u8(e.player.slot).u8(ArcadeGame.flags(e.player)).u16(e.queue.ackSeq).f32(e.s.p);
      w.u8((e.alive ? 1 : 0) | (e.inv > 0 ? 2 : 0)).u16(Math.min(65535, e.score));
    }
    w.u8(this.shots.length);
    for (const s of this.shots) w.i16(Math.round(s.x * 4)).i16(Math.round(s.y * 4)).u8(s.owner.player.slot);
    w.u8(this.bombs.length);
    for (const b of this.bombs) w.i16(Math.round(b.x * 4)).i16(Math.round(b.y * 4));
    for (const cells of this.bunkers) {
      for (let b = 0; b < 12; b++) {
        let v = 0;
        for (let k = 0; k < 8; k++) if (cells[b * 8 + k]) v |= 1 << k;
        w.u8(v);
      }
    }
    w.i16(this.ufo ? Math.round(this.ufo.x * 4) : -32768);
  }

  results() {
    const sorted = [...this.ents].sort((a, b) => b.score - a.score);
    const won = this.wavesMax && this.wave >= this.wavesMax && !this._remaining();
    return {
      title: won ? `Ruimtegolf: alle ${this.wavesMax} golven verslagen!` : `Ruimtegolf: gesneuveld in golf ${this.wave}`,
      columns: ['Punten', 'Aliens'],
      rows: this.rows(sorted, (e) => [e.score, e.kills]),
    };
  }
}

export default {
  id: 'invaders',
  realtime: true,
  create: (room, settings) => new InvadersGame(room, settings),
};

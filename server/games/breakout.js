// Stenenbreker (server side): co-op breakout. Every player has a paddle
// (they may overlap) and their own ball; the team shares its lives.
// Three levels, power-up capsules, bots that track the ball.
import { ArcadeGame } from './arcade.js';
import { BTN } from '../../shared/messages.js';
import { BF, BRICK, CAPS, LEVELS, parseLevel, brickX, brickY, stepBreakoutPaddle } from '../../shared/games/breakout.js';

const BALL_SPEED = 128;
const BALL_MAX = 205;
const AUTO_LAUNCH_S = 3;
const MAX_IDLE_MISSES = 2;
const IDLE_LAUNCH_S = 12;
const CAP_CHANCE = 0.12;
const CAP_SPEED = 42;
const WIDE_S = 12;
const SLOW_S = 8;
const LEVEL_PAUSE_S = 2.5;
const MAX_BALLS = 24;
const POINTS = { [BRICK.NORMAL]: 10, [BRICK.TOUGH]: 25 };

const BOT = {
  easy: { replan: 0.35, error: 10, launch: 1.5 },
  normal: { replan: 0.18, error: 5, launch: 0.8 },
  hard: { replan: 0.06, error: 2, launch: 0.3 },
};

class BreakoutGame extends ArcadeGame {
  constructor(room, settings) {
    super(room, settings);
    this.level = 0;
    this.balls = [];
    this.caps = [];
    this.nextBall = 1;
    this.slow = 0;
    this.addPlayers();
    this.lives = 3 + Math.floor(this.ents.length / 2);
    this._startLevel();
  }

  createEntity() {
    return { s: { p: BF.width / 2, wide: 0 }, score: 0, bricks: 0, target: BF.width / 2, planIn: 0, launchIn: AUTO_LAUNCH_S, misses: 0 };
  }

  onJoin(player) {
    super.onJoin(player);
    if (this.bricks) this._attach(this.ent(player.id));
  }

  onLeave(player) {
    super.onLeave(player);
    this.balls = this.balls.filter((b) => b.owner.player.id !== player.id);
  }

  _startLevel() {
    this.bricks = parseLevel(this.level);
    this.balls = [];
    this.caps = [];
    this.slow = 0;
    for (const e of this.ents) {
      e.s.p = BF.width / 2;
      e.s.wide = 0;
      this._attach(e);
    }
    this.startCountdown(this.level === 0 ? 3 : 2);
    this.room.emit('level', { n: this.level + 1 });
  }

  nextRound() {
    this._startLevel();
  }

  _attach(e) {
    if (this.balls.length >= MAX_BALLS) return;
    this.balls.push({ id: this.nextBall, owner: e, attached: true, x: e.s.p, y: BF.paddleY - BF.ballR - 1, vx: 0, vy: 0, speed: BALL_SPEED });
    this.nextBall = (this.nextBall % 65535) + 1;
    // The ball launches by itself, but much later for a player who lost it
    // twice in a row without touching it (away from the keys: the team keeps its lives).
    e.launchIn = !e.player.isBot && e.misses >= MAX_IDLE_MISSES ? IDLE_LAUNCH_S : AUTO_LAUNCH_S;
  }

  _launch(e) {
    for (const b of this.balls) {
      if (b.owner !== e || !b.attached) continue;
      b.attached = false;
      const a = (this.rng() - 0.5) * 0.9;
      b.vx = Math.sin(a) * b.speed;
      b.vy = -Math.cos(a) * b.speed;
      this.room.emit('launch', { s: e.player.slot });
    }
  }

  step(dt) {
    if (this.slow > 0) this.slow = Math.max(0, this.slow - dt);
    for (const e of this.ents) {
      if (e.player.isBot) this._bot(e, dt);
      else {
        this.eachInput(e, (inp) => {
          stepBreakoutPaddle(e.s, inp.ax, dt);
          if (inp.buttons & BTN.A) {
            e.misses = 0;
            this._launch(e);
          }
        });
      }
      e.launchIn -= dt;
      if (e.launchIn <= 0) this._launch(e);
    }

    const factor = this.slow > 0 ? 0.7 : 1;
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      if (b.attached) {
        b.x = b.owner.s.p;
        b.y = BF.paddleY - BF.ballR - 1;
        continue;
      }
      let lost = false;
      for (let k = 0; k < 3 && !lost; k++) lost = this._moveBall(b, (dt / 3) * factor);
      if (lost) {
        this.balls.splice(i, 1);
        this._lost(b.owner);
        if (!this.playing) return;
      }
    }
    this._stepCaps(dt);

    let left = 0;
    for (const v of this.bricks) if (v === BRICK.NORMAL || v === BRICK.TOUGH) left++;
    if (!left) {
      this.level++;
      if (this.level >= LEVELS.length) this.finish({ win: true });
      else this.endRound(LEVEL_PAUSE_S, { level: this.level });
    }
  }

  // Returns true when the ball fell out.
  _moveBall(b, dt) {
    const r = BF.ballR;
    // X then Y, so brick hits know which side they came from.
    const nx = b.x + b.vx * dt;
    if (nx < r || nx > BF.width - r) {
      b.vx = -b.vx;
      this.room.emit('wall');
    } else if (this._hitBrick(b, nx + Math.sign(b.vx) * r, b.y)) {
      b.vx = -b.vx;
    } else b.x = nx;

    const ny = b.y + b.vy * dt;
    if (ny < BF.top + r) {
      b.vy = Math.abs(b.vy);
      this.room.emit('wall');
      return false;
    }
    if (this._hitBrick(b, b.x, ny + Math.sign(b.vy) * r)) {
      b.vy = -b.vy;
      return false;
    }
    b.y = ny;

    // Paddles (any paddle, not only your own)
    if (b.vy > 0 && b.y + r >= BF.paddleY && b.y - r <= BF.paddleY + BF.paddleH) {
      let best = null;
      let bestD = Infinity;
      for (const e of this.ents) {
        const half = (e.s.wide > 0 ? BF.wideW : BF.paddleW) / 2;
        const d = Math.abs(b.x - e.s.p);
        if (d <= half + r && d < bestD) { best = e; bestD = d; }
      }
      if (best) {
        const half = (best.s.wide > 0 ? BF.wideW : BF.paddleW) / 2;
        const off = Math.max(-1, Math.min(1, (b.x - best.s.p) / half));
        const a = off * (60 * Math.PI) / 180;
        b.vx = Math.sin(a) * b.speed;
        b.vy = -Math.cos(a) * b.speed;
        b.y = BF.paddleY - r;
        best.misses = 0;
        this.room.emit('paddle', { s: best.player.slot });
      }
    }
    return b.y - r > BF.height;
  }

  _hitBrick(b, x, y) {
    const col = Math.floor((x - BF.x0) / (BF.brickW + BF.gap));
    const row = Math.floor((y - BF.y0) / (BF.brickH + BF.gap));
    if (col < 0 || row < 0 || col >= BF.cols || row >= BF.rows) return false;
    if (x - brickX(col) > BF.brickW || y - brickY(row) > BF.brickH) return false; // in the gap
    const i = row * BF.cols + col;
    const v = this.bricks[i];
    if (v === BRICK.EMPTY) return false;
    if (v === BRICK.STEEL) {
      this.room.emit('steel');
      return true;
    }
    const owner = b.owner;
    if (v === BRICK.TOUGH) this.bricks[i] = BRICK.NORMAL;
    else this.bricks[i] = BRICK.EMPTY;
    owner.score += v === BRICK.TOUGH ? 5 : POINTS[BRICK.NORMAL];
    if (this.bricks[i] === BRICK.EMPTY) {
      owner.bricks++;
      b.speed = Math.min(BALL_MAX, b.speed * 1.012);
      const cx = brickX(col) + BF.brickW / 2;
      const cy = brickY(row) + BF.brickH / 2;
      this.room.emit('brick', { x: Math.round(cx), y: Math.round(cy), s: owner.player.slot });
      if (this.rng() < CAP_CHANCE) this.caps.push({ x: cx, y: cy, type: Math.floor(this.rng() * CAPS.length) });
    } else this.room.emit('crack', { x: Math.round(brickX(col) + BF.brickW / 2), y: Math.round(brickY(row) + BF.brickH / 2) });
    return true;
  }

  _stepCaps(dt) {
    for (let i = this.caps.length - 1; i >= 0; i--) {
      const c = this.caps[i];
      c.y += CAP_SPEED * dt;
      if (c.y > BF.height + 4) { this.caps.splice(i, 1); continue; }
      if (c.y < BF.paddleY - 3 || c.y > BF.paddleY + BF.paddleH + 3) continue;
      const catcher = this.ents.find((e) => Math.abs(c.x - e.s.p) <= (e.s.wide > 0 ? BF.wideW : BF.paddleW) / 2 + 3);
      if (!catcher) continue;
      this.caps.splice(i, 1);
      this._applyCap(catcher, c.type);
    }
  }

  _applyCap(e, type) {
    const key = CAPS[type].key;
    if (key === 'wide') e.s.wide = Math.fround(WIDE_S);
    else if (key === 'slow') this.slow = SLOW_S;
    else if (key === 'life') this.lives++;
    else if (key === 'multi') {
      const src = this.balls.find((b) => b.owner === e && !b.attached) ?? this.balls.find((b) => !b.attached);
      if (src) {
        for (const a of [-0.5, 0.5]) {
          if (this.balls.length >= MAX_BALLS) break;
          const ang = Math.atan2(src.vx, -src.vy) + a;
          this.balls.push({ id: this.nextBall, owner: e, attached: false, x: src.x, y: src.y, vx: Math.sin(ang) * src.speed, vy: -Math.abs(Math.cos(ang) * src.speed), speed: src.speed });
          this.nextBall = (this.nextBall % 65535) + 1;
        }
      }
    }
    this.room.emit('cap', { s: e.player.slot, type });
  }

  _lost(owner) {
    this.room.emit('lost', { s: owner.player.slot });
    if (this.balls.some((b) => b.owner === owner)) return; // still has a ball in play
    owner.misses++;
    this.lives--;
    if (this.lives <= 0) {
      this.finish({ win: false });
      return;
    }
    if (this.ents.includes(owner)) this._attach(owner);
  }

  _bot(e, dt) {
    const cfg = BOT[e.player.botLevel] ?? BOT.normal;
    e.planIn -= dt;
    if (e.planIn <= 0) {
      e.planIn = cfg.replan;
      e.target = this._predict(e) + (this.rng() - 0.5) * 2 * cfg.error;
    }
    const diff = e.target - e.s.p;
    stepBreakoutPaddle(e.s, Math.abs(diff) < 1.5 ? 0 : Math.max(-1, Math.min(1, diff / 10)), dt);
    if (e.launchIn < AUTO_LAUNCH_S - cfg.launch) this._launch(e);
  }

  // x where the most urgent descending ball reaches the paddles.
  _predict(e) {
    let best = null;
    let bestT = Infinity;
    for (const b of this.balls) {
      if (b.attached || b.vy <= 0) continue;
      const t = (BF.paddleY - b.y) / b.vy;
      if (t < 0 || t > bestT + (b.owner === e ? 0.4 : 0)) continue;
      const span = BF.width - 2 * BF.ballR;
      let x = b.x - BF.ballR + b.vx * t;
      x = ((x % (2 * span)) + 2 * span) % (2 * span);
      if (x > span) x = 2 * span - x;
      best = x + BF.ballR;
      bestT = t;
    }
    return best ?? BF.width / 2;
  }

  // Body: u8 phase, f32 left, u8 level, u8 lives, u8 slow,
  // u8 n × [u8 slot, u8 flags, u16 ack, f32 p, f32 wide, u16 score],
  // u8 balls × [u16 id, u8 owner, u8 attached, i16 x*8, i16 y*8],
  // bricks (cols × rows bytes), u8 caps × [i16 x*4, i16 y*4, u8 type]
  snapshot(w) {
    this.writePhase(w);
    w.u8(this.level).u8(Math.max(0, Math.min(255, this.lives))).u8(this.slow > 0 ? 1 : 0);
    w.u8(this.ents.length);
    for (const e of this.ents) {
      w.u8(e.player.slot).u8(ArcadeGame.flags(e.player)).u16(e.queue.ackSeq).f32(e.s.p).f32(e.s.wide).u16(Math.min(65535, e.score));
    }
    w.u8(this.balls.length);
    for (const b of this.balls) {
      w.u16(b.id).u8(b.owner.player.slot).u8(b.attached ? 1 : 0).i16(Math.round(b.x * 8)).i16(Math.round(b.y * 8));
    }
    for (let i = 0; i < this.bricks.length; i++) w.u8(this.bricks[i]);
    w.u8(this.caps.length);
    for (const c of this.caps) w.i16(Math.round(c.x * 4)).i16(Math.round(c.y * 4)).u8(c.type);
  }

  results() {
    const sorted = [...this.ents].sort((a, b) => b.score - a.score);
    const won = this.level >= LEVELS.length;
    return {
      title: won ? 'Stenenbreker: alle muren zijn kapot!' : `Stenenbreker: gestrand in level ${this.level + 1}`,
      columns: ['Punten', 'Stenen'],
      rows: this.rows(sorted, (e) => [e.score, e.bricks]),
    };
  }
}

export default {
  id: 'breakout',
  realtime: true,
  create: (room, settings) => new BreakoutGame(room, settings),
};

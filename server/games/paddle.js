// Paddle Party (server side): pong for two to four players, one per side of
// a square field. Empty or eliminated sides are walls. More balls join the
// longer a game lasts. Last player with lives left wins.
import { ArcadeGame } from './arcade.js';
import { stepPaddle } from '../../shared/physics/paddle.js';
import { PF, paddleMin, paddleMax, sideAxis, isHorizontal } from '../../shared/games/paddle.js';
import { ARCADE_PHASE } from '../../shared/games/arcade.js';

const START_SPEED = 95;
const MAX_SPEED = 205;
const SPEEDUP = 1.045;
const SERVE_WAIT_S = 1.1;
const EXTRA_BALL_EVERY_S = 25;
const MAX_BALLS = 3;
const MAX_BOUNCE = (60 * Math.PI) / 180;
const S = PF.size;

const LEVELS = {
  easy: { replan: 0.35, error: 14, speed: 0.7 },
  normal: { replan: 0.2, error: 7, speed: 0.9 },
  hard: { replan: 0.08, error: 2.5, speed: 1 },
};

class PaddleGame extends ArcadeGame {
  constructor(room, settings) {
    super(room, settings);
    this.livesStart = settings.lives ?? 5;
    this.balls = [];
    this.nextBall = 1;
    this.out = [];
    this.addPlayers();
    this.playTime = 0;
    this.extraIn = EXTRA_BALL_EVERY_S;
  }

  createEntity() {
    return { side: -1, s: { p: S / 2 }, lives: this.livesStart, alive: true, target: S / 2, planIn: 0, hits: 0 };
  }

  onJoin(player) {
    super.onJoin(player);
    const e = this.ent(player.id);
    const used = new Set(this.ents.filter((o) => o !== e).map((o) => o.side));
    e.side = [0, 1, 2, 3].find((sd) => !used.has(sd)) ?? -1;
    // Late joiners (after the countdown) watch until the next game.
    e.alive = e.side >= 0 && this.phase === ARCADE_PHASE.COUNTDOWN;
  }

  onStart() {
    this._serve();
  }

  _serve() {
    const alive = this.ents.filter((e) => e.alive);
    const target = alive[Math.floor(this.rng() * alive.length)];
    const toward = [[0, 1], [0, -1], [-1, 0], [1, 0]][target?.side ?? 0];
    const spread = (this.rng() - 0.5) * 0.8;
    const [dx, dy] = rotate(toward, spread);
    this.balls.push({ id: this.nextBall, x: S / 2, y: S / 2, vx: dx * START_SPEED, vy: dy * START_SPEED, wait: SERVE_WAIT_S, speed: START_SPEED });
    this.nextBall = (this.nextBall % 65535) + 1;
  }

  _sideOwner(side) {
    return this.ents.find((e) => e.side === side && e.alive) ?? null;
  }

  step(dt) {
    this.playTime += dt;
    for (const e of this.ents) {
      if (!e.alive) {
        if (!e.player.isBot) this.eachInput(e, () => {});
        continue;
      }
      if (e.player.isBot) this._bot(e, dt);
      else this.eachInput(e, (inp) => stepPaddle(e.s, sideAxis(e.side, inp.ax, inp.ay), dt, paddleMin(), paddleMax()));
    }
    this.extraIn -= dt;
    if (this.extraIn <= 0 && this.balls.length < MAX_BALLS) {
      this.extraIn = EXTRA_BALL_EVERY_S;
      this._serve();
      this.room.emit('extraBall');
    }
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      if (b.wait > 0) {
        b.wait -= dt;
        continue;
      }
      for (let k = 0; k < 3; k++) {
        const scored = this._moveBall(b, dt / 3);
        if (scored !== null) {
          this.balls.splice(i, 1);
          this._goal(scored, b);
          break;
        }
      }
    }
    const alive = this.ents.filter((e) => e.alive);
    if (alive.length <= 1) {
      this.finish({ s: alive[0]?.player.slot ?? -1 });
      return;
    }
    if (!this.balls.length) this._serve();
  }

  // Returns the side the ball left the field through (a goal), or null.
  _moveBall(b, dt) {
    const r = PF.ballR;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    // Corner blocks
    const c = PF.corner;
    if ((b.x < c + r || b.x > S - c - r) && (b.y < c + r || b.y > S - c - r)) {
      const inX = b.x < c + r ? c + r - b.x : b.x - (S - c - r);
      const inY = b.y < c + r ? c + r - b.y : b.y - (S - c - r);
      if (inX < inY) { b.vx = b.x < S / 2 ? Math.abs(b.vx) : -Math.abs(b.vx); b.x = b.x < S / 2 ? c + r : S - c - r; }
      else { b.vy = b.y < S / 2 ? Math.abs(b.vy) : -Math.abs(b.vy); b.y = b.y < S / 2 ? c + r : S - c - r; }
    }
    // Paddles and walls on each side
    for (let side = 0; side < 4; side++) {
      const owner = this._sideOwner(side);
      const horiz = isHorizontal(side);
      const edge = side === 0 || side === 3 ? S : 0;
      const dir = side === 0 || side === 3 ? 1 : -1; // outward direction on the axis
      const along = horiz ? b.x : b.y;
      const across = horiz ? b.y : b.x;
      const vAcross = horiz ? b.vy : b.vx;
      const line = edge - dir * (PF.inset + PF.paddleThick);
      if (owner) {
        const reach = PF.paddleLen / 2 + r;
        const moving = vAcross * dir > 0;
        const atLine = dir > 0 ? across + r >= line && across - r <= line + PF.paddleThick : across - r <= line && across + r >= line - PF.paddleThick;
        if (moving && atLine && Math.abs(along - owner.s.p) <= reach) {
          // Bounce: the angle depends on where the paddle was hit.
          const off = Math.max(-1, Math.min(1, (along - owner.s.p) / (PF.paddleLen / 2)));
          b.speed = Math.min(MAX_SPEED, b.speed * SPEEDUP);
          const a = off * MAX_BOUNCE;
          const inward = -dir;
          if (horiz) { b.vx = Math.sin(a) * b.speed; b.vy = Math.cos(a) * b.speed * inward; b.y = dir > 0 ? line - r : line + r; }
          else { b.vy = Math.sin(a) * b.speed; b.vx = Math.cos(a) * b.speed * inward; b.x = dir > 0 ? line - r : line + r; }
          owner.hits++;
          this.room.emit('hit', { s: owner.player.slot });
          continue;
        }
        if (dir > 0 ? across - r > S : across + r < 0) return side;
      } else if (dir > 0 ? across + r > S : across - r < 0) {
        // Wall
        if (horiz) { b.vy = -b.vy; b.y = dir > 0 ? S - r : r; }
        else { b.vx = -b.vx; b.x = dir > 0 ? S - r : r; }
        this.room.emit('wall');
      }
    }
    return null;
  }

  _goal(side, ball) {
    const e = this._sideOwner(side);
    if (!e) return;
    e.lives--;
    this.room.emit('goal', { s: e.player.slot, x: Math.round(ball.x), y: Math.round(ball.y) });
    if (e.lives <= 0) {
      e.alive = false;
      this.out.push(e);
      this.room.emit('out', { s: e.player.slot });
    }
  }

  // Bots: predict where the most urgent ball crosses their paddle line.
  _bot(e, dt) {
    const cfg = LEVELS[e.player.botLevel] ?? LEVELS.normal;
    e.planIn -= dt;
    if (e.planIn <= 0) {
      e.planIn = cfg.replan * (0.7 + this.rng() * 0.6);
      e.target = this._predict(e.side) ?? S / 2;
      e.target += (this.rng() - 0.5) * 2 * cfg.error;
    }
    const diff = e.target - e.s.p;
    const axis = Math.abs(diff) < 1.5 ? 0 : Math.sign(diff) * Math.min(1, Math.abs(diff) / 12) * cfg.speed;
    stepPaddle(e.s, axis, dt, paddleMin(), paddleMax());
  }

  _predict(side) {
    const horiz = isHorizontal(side);
    const dir = side === 0 || side === 3 ? 1 : -1;
    const line = (dir > 0 ? S : 0) - dir * (PF.inset + PF.paddleThick);
    let best = null;
    let bestT = Infinity;
    for (const b of this.balls) {
      const vAcross = horiz ? b.vy : b.vx;
      if (vAcross * dir <= 0) continue;
      const across = horiz ? b.y : b.x;
      const t = (line - across) / vAcross + Math.max(0, b.wait);
      if (t < 0 || t > bestT) continue;
      // Fold the path along the other axis (reflections off the side walls).
      let pos = (horiz ? b.x : b.y) + (horiz ? b.vx : b.vy) * t;
      const lo = PF.corner;
      const span = S - 2 * lo;
      pos -= lo;
      pos = ((pos % (2 * span)) + 2 * span) % (2 * span);
      if (pos > span) pos = 2 * span - pos;
      best = pos + lo;
      bestT = t;
    }
    return best;
  }

  // Body: u8 phase, f32 left, u8 n × [u8 slot, u8 flags, i8 side, u8 lives, u8 alive, u16 ack, f32 p],
  // u8 balls × [u16 id, i16 x*16, i16 y*16, u8 waiting]
  snapshot(w) {
    this.writePhase(w);
    w.u8(this.ents.length);
    for (const e of this.ents) {
      w.u8(e.player.slot).u8(ArcadeGame.flags(e.player)).i8(e.side).u8(Math.max(0, e.lives)).u8(e.alive ? 1 : 0);
      w.u16(e.queue.ackSeq).f32(e.s.p);
    }
    w.u8(this.balls.length);
    for (const b of this.balls) w.u16(b.id).i16(Math.round(b.x * 16)).i16(Math.round(b.y * 16)).u8(b.wait > 0 ? 1 : 0);
  }

  results() {
    const alive = this.ents.filter((e) => e.alive);
    const sorted = [...alive.sort((a, b) => b.lives - a.lives), ...[...this.out].reverse()];
    for (const e of this.ents) if (!sorted.includes(e)) sorted.push(e);
    return {
      title: 'Uitslag Paddle Party',
      columns: ['Levens over', 'Ballen geraakt'],
      rows: this.rows(sorted, (e) => [Math.max(0, e.lives), e.hits]),
    };
  }
}

function rotate([x, y], a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}

export default {
  id: 'paddle',
  realtime: true,
  create: (room, settings) => new PaddleGame(room, settings),
};

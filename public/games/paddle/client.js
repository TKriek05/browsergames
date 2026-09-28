// Paddle Party (client side): your paddle is predicted, balls and the other
// paddles are interpolated. Bottom/top move with left/right, the sides with
// up/down.
import { stepPaddle } from '../../../shared/physics/paddle.js';
import { PF, SIDE_NAMES, paddleMin, paddleMax, sideAxis, isHorizontal } from '../../../shared/games/paddle.js';
import { createArcadeCore, ARCADE_PHASE, lerp, isConnected } from '../common/arcade.js';
import { Predictor } from '../../js/core/predict.js';
import { drawText, roundRect, heart } from '../../js/core/hudtext.js';
import { createFx } from '../../js/core/fx.js';
import { createSharpLayer } from '../../js/core/canvas.js';

export const meta = { width: 320, height: 180, pixelated: false, step: 1 / 30, touchButtons: [] };

const OX = 72;
const OY = 2;
const S = PF.size;
const SHADOW = '#2a1a10';

function decode(r, time) {
  const s = { time, phase: r.u8(), endsAt: 0, ents: [], balls: [] };
  s.endsAt = time + r.f32() * 1000;
  const n = r.u8();
  for (let i = 0; i < n; i++) {
    s.ents.push({ slot: r.u8(), flags: r.u8(), side: r.i8(), lives: r.u8(), alive: r.u8() === 1, ack: r.u16(), p: r.f32() });
  }
  const m = r.u8();
  for (let i = 0; i < m; i++) s.balls.push({ id: r.u16(), x: r.i16() / 16, y: r.i16() / 16, wait: r.u8() === 1 });
  return s;
}

// Paddle rectangle in field coordinates.
function paddleRect(side, p) {
  const L = PF.paddleLen;
  const T = PF.paddleThick;
  switch (side) {
    case 0: return [p - L / 2, S - PF.inset - T, L, T];
    case 1: return [p - L / 2, PF.inset, L, T];
    case 2: return [PF.inset, p - L / 2, T, L];
    default: return [S - PF.inset - T, p - L / 2, T, L];
  }
}

export function createGame() {
  let side = -1;
  const predictor = new Predictor({
    create: () => ({ p: S / 2 }),
    copy: (d, s) => { d.p = s.p; },
    step: (s, inp) => stepPaddle(s, sideAxis(side, inp.ax, inp.ay), 1 / 30, paddleMin(), paddleMax()),
    smoothKeys: ['p'],
  });
  const core = createArcadeCore({ decode, predictor, toServer: (e, out) => { out.p = e.p; } });
  let ctx, input, sfx, fx, bg;
  const trails = new Map();

  return {
    mount(view, net, c) {
      ctx = view.ctx;
      input = c.input;
      sfx = c.sfx;
      core.mount(net, c);
      fx = createFx({ reducedMotion: c.reducedMotion, smooth: true });
      bg = createSharpLayer(view, drawField);
    },

    onSnapshot(snap) {
      const s = core.onSnapshot(snap);
      const mine = core.find(s.ents, core.mySlot());
      side = mine ? mine.side : -1;
    },

    onEvent(msg) {
      const slot = core.mySlot();
      switch (msg.e) {
        case 'go': sfx.play('go'); break;
        case 'hit': sfx.play(msg.s === slot ? 'ready' : 'click'); break;
        case 'wall': sfx.play('click'); break;
        case 'goal':
          sfx.play(msg.s === slot ? 'lose' : 'hit');
          fx.burst(OX + msg.x, OY + msg.y, core.hex(msg.s), 24, { speed: 70, life: 0.6 });
          fx.shake(msg.s === slot ? 5 : 2);
          break;
        case 'out': fx.text(`${core.name(msg.s).toUpperCase()} IS AF`, 160, 90, core.hex(msg.s), 2, 1.6); break;
        case 'extraBall': fx.text('EXTRA BAL!', 160, 70, '#ffe14d', 2, 1.2); sfx.play('coin'); break;
        case 'end': sfx.play(msg.s === slot ? 'win' : 'countdown'); break;
        default: break;
      }
    },

    onReconnect() {
      core.reset();
    },

    update(dt) {
      fx.update(dt);
      core.beep();
      const inp = input.sample();
      const me = core.mine();
      if (core.latest?.phase === ARCADE_PHASE.PLAY && me?.alive && predictor.ready) core.send(inp.ax, inp.ay, 0);
      else core.idle();
    },

    render(alpha) {
      ctx.save();
      ctx.translate(fx.shakeX(), fx.shakeY());
      bg.blit(ctx);
      const s = core.latest;
      const sample = core.sample();
      if (s && sample) {
        const a = sample.a.state;
        const b = sample.b.state;
        // Walls where nobody plays (or who is out)
        for (let sd = 0; sd < 4; sd++) {
          const owner = b.ents.find((e) => e.side === sd && e.alive);
          if (owner) continue;
          // An empty side: a white board closes it off.
          ctx.fillStyle = '#e8e8e8';
          if (sd === 0) roundRect(ctx, OX, OY + S - 3, S, 3, 1.5);
          if (sd === 1) roundRect(ctx, OX, OY, S, 3, 1.5);
          if (sd === 2) roundRect(ctx, OX, OY, 3, S, 1.5);
          if (sd === 3) roundRect(ctx, OX + S - 3, OY, 3, S, 1.5);
          ctx.fill();
        }
        for (const eb of b.ents) {
          if (!eb.alive || eb.side < 0) continue;
          const ea = core.find(a.ents, eb.slot) ?? eb;
          const me = eb.slot === core.mySlot() && predictor.ready;
          const p = me ? predictor.get('p', alpha) : lerp(ea.p, eb.p, sample.t);
          const [x, y, w, h] = paddleRect(eb.side, p);
          // Bat: rubber in the player's colour on a wooden blade.
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          roundRect(ctx, OX + x + 0.8, OY + y + 1.2, w, h, Math.min(w, h) / 2);
          ctx.fill();
          ctx.fillStyle = '#c8945a';
          roundRect(ctx, OX + x - 0.5, OY + y - 0.5, w + 1, h + 1, Math.min(w, h) / 2 + 0.5);
          ctx.fill();
          ctx.fillStyle = core.hex(eb.slot);
          roundRect(ctx, OX + x, OY + y, w, h, Math.min(w, h) / 2);
          ctx.fill();
          if (me) {
            ctx.fillStyle = '#ffffff';
            if (isHorizontal(eb.side)) roundRect(ctx, OX + x + w / 2 - 3, OY + y + h / 2 - 0.4, 6, 0.8, 0.4);
            else roundRect(ctx, OX + x + w / 2 - 0.4, OY + y + h / 2 - 3, 0.8, 6, 0.4);
            ctx.fill();
          }
        }
        core.each(sample, 'balls', 'id', (bb, x, y) => {
          const trail = trails.get(bb.id) ?? [];
          trail.push([x, y]);
          if (trail.length > 6) trail.shift();
          trails.set(bb.id, trail);
          trail.forEach(([tx, ty], i) => {
            ctx.globalAlpha = (i + 1) / (trail.length * 3);
            ctx.fillStyle = '#ffc080';
            ctx.beginPath();
            ctx.arc(OX + tx, OY + ty, 1.5, 0, Math.PI * 2);
            ctx.fill();
          });
          ctx.globalAlpha = bb.wait && Math.floor(performance.now() / 150) % 2 ? 0.4 : 1;
          // Ball with its shadow on the table
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.beginPath();
          ctx.arc(OX + x + 1.2, OY + y + 1.6, 2.4, 0, Math.PI * 2);
          ctx.fill();
          const g = ctx.createRadialGradient(OX + x - 0.8, OY + y - 0.8, 0.3, OX + x, OY + y, 2.6);
          g.addColorStop(0, '#ffe0b8');
          g.addColorStop(1, '#ff8a1a');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(OX + x, OY + y, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        });
        if (trails.size > 12) trails.clear();
      }
      fx.drawParticles(ctx);
      if (s) this.panels(s);
      fx.drawTexts(ctx);
      ctx.restore();
    },

    panels(s) {
      // Players with their side and lives, left and right of the field.
      const sorted = [...s.ents].sort((p, q) => p.side - q.side);
      sorted.forEach((e, i) => {
        const x = i % 2 ? 252 : 4;
        const y = 8 + Math.floor(i / 2) * 44;
        ctx.fillStyle = core.hex(e.slot);
        ctx.globalAlpha = isConnected(e.flags) ? 1 : 0.5;
        roundRect(ctx, x, y, 4, 16, 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        drawText(ctx, e.slot === core.mySlot() ? 'JIJ' : core.name(e.slot).slice(0, 10), x + 8, y, { color: e.alive ? '#ffffff' : '#6a5a4a', shadow: SHADOW });
        drawText(ctx, e.side >= 0 ? SIDE_NAMES[e.side] : '', x + 8, y + 9, { color: '#f4e4c8', shadow: SHADOW });
        for (let k = 0; k < Math.min(e.lives, 9); k++) {
          heart(ctx, x + 10.5 + k * 6.5, y + 21.5, 5.5);
          ctx.fillStyle = e.alive ? '#e63946' : '#6a5a4a';
          ctx.fill();
        }
        if (!e.alive) drawText(ctx, 'AF', x + 8, y + 19, { color: '#ff4d6d' });
      });
      if (s.phase === ARCADE_PHASE.COUNTDOWN) {
        drawText(ctx, String(Math.max(1, Math.ceil(core.secondsLeft()))), OX + S / 2, 64, { color: '#ffe14d', scale: 5, align: 'center', shadow: SHADOW });
        const me = core.mine();
        if (me && me.side >= 0) drawText(ctx, `JIJ SPEELT ${SIDE_NAMES[me.side]}`, OX + S / 2, 104, { color: core.hex(me.slot), align: 'center', shadow: SHADOW });
      } else if (s.phase === ARCADE_PHASE.END) {
        const winner = s.ents.find((e) => e.alive);
        drawText(ctx, winner ? (winner.slot === core.mySlot() ? 'JIJ WINT!' : `${core.name(winner.slot).toUpperCase()} WINT`) : 'EINDE', OX + S / 2, 76, { color: winner ? core.hex(winner.slot) : '#ffffff', scale: 2, align: 'center', shadow: SHADOW });
      }
    },

    unmount() {},
  };
}

// A table-tennis table in a sports hall: wooden floor, blue table with
// white lines and a shadow, wooden corner posts.
function drawField(ctx) {
  ctx.fillStyle = '#a8703f';
  ctx.fillRect(0, 0, 320, 180);
  for (let y = 0; y < 180; y += 6) {
    ctx.fillStyle = (y / 6) % 2 ? '#9e6838' : '#b07846';
    ctx.fillRect(0, y, 320, 6);
    ctx.fillStyle = 'rgba(90, 58, 30, 0.6)';
    ctx.fillRect(0, y, 320, 0.3);
    for (let x = ((y / 6) % 3) * 23; x < 320; x += 70) ctx.fillRect(x, y, 0.4, 6);
  }
  // Court lines of the sports hall
  ctx.strokeStyle = 'rgba(255, 240, 200, 0.35)';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(20, 10, 280, 160);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  roundRect(ctx, OX + 3, OY + 4, S, S, 2);
  ctx.fill();
  ctx.fillStyle = '#1f5fa8';
  roundRect(ctx, OX, OY, S, S, 1.5);
  ctx.fill();
  ctx.strokeStyle = '#f4f4f4';
  ctx.lineWidth = 1;
  ctx.strokeRect(OX + 0.5, OY + 0.5, S - 1, S - 1);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(OX + S / 2, OY); ctx.lineTo(OX + S / 2, OY + S);
  ctx.moveTo(OX, OY + S / 2); ctx.lineTo(OX + S, OY + S / 2);
  ctx.stroke();
  const c = PF.corner;
  for (const [x, y] of [[0, 0], [S - c, 0], [0, S - c], [S - c, S - c]]) {
    ctx.fillStyle = '#5a3a22';
    roundRect(ctx, OX + x, OY + y, c, c, 2);
    ctx.fill();
    ctx.fillStyle = '#7a5030';
    roundRect(ctx, OX + x + 2, OY + y + 2, c - 4, c - 4, 1.5);
    ctx.fill();
  }
}

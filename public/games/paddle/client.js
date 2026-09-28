// Paddle Party (client side): your paddle is predicted, balls and the other
// paddles are interpolated. Bottom/top move with left/right, the sides with
// up/down.
import { stepPaddle } from '../../../shared/physics/paddle.js';
import { PF, SIDE_NAMES, paddleMin, paddleMax, sideAxis, isHorizontal } from '../../../shared/games/paddle.js';
import { createArcadeCore, ARCADE_PHASE, lerp, isConnected } from '../common/arcade.js';
import { Predictor } from '../../js/core/predict.js';
import { drawText } from '../../js/core/pixelfont.js';
import { createFx } from '../../js/core/fx.js';
import { createLayer } from '../../js/core/canvas.js';

export const meta = { width: 320, height: 180, pixelated: true, step: 1 / 30, touchButtons: [] };

const OX = 72;
const OY = 2;
const S = PF.size;
const SHADOW = '#0b0b1e';

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
      fx = createFx({ reducedMotion: c.reducedMotion });
      bg = drawField();
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
      ctx.drawImage(bg, 0, 0);
      const s = core.latest;
      const sample = core.sample();
      if (s && sample) {
        const a = sample.a.state;
        const b = sample.b.state;
        // Walls where nobody plays (or who is out)
        for (let sd = 0; sd < 4; sd++) {
          const owner = b.ents.find((e) => e.side === sd && e.alive);
          if (owner) continue;
          ctx.fillStyle = '#3a3486';
          if (sd === 0) ctx.fillRect(OX, OY + S - 3, S, 3);
          if (sd === 1) ctx.fillRect(OX, OY, S, 3);
          if (sd === 2) ctx.fillRect(OX, OY, 3, S);
          if (sd === 3) ctx.fillRect(OX + S - 3, OY, 3, S);
        }
        for (const eb of b.ents) {
          if (!eb.alive || eb.side < 0) continue;
          const ea = core.find(a.ents, eb.slot) ?? eb;
          const me = eb.slot === core.mySlot() && predictor.ready;
          const p = me ? predictor.get('p', alpha) : lerp(ea.p, eb.p, sample.t);
          const [x, y, w, h] = paddleRect(eb.side, p);
          ctx.fillStyle = SHADOW;
          ctx.fillRect(Math.round(OX + x) - 1, Math.round(OY + y) - 1, Math.round(w) + 2, Math.round(h) + 2);
          ctx.fillStyle = core.hex(eb.slot);
          ctx.fillRect(Math.round(OX + x), Math.round(OY + y), Math.round(w), Math.round(h));
          if (me) {
            ctx.fillStyle = '#ffffff';
            if (isHorizontal(eb.side)) ctx.fillRect(Math.round(OX + x + w / 2 - 3), Math.round(OY + y + h / 2), 6, 1);
            else ctx.fillRect(Math.round(OX + x + w / 2), Math.round(OY + y + h / 2 - 3), 1, 6);
          }
        }
        core.each(sample, 'balls', 'id', (bb, x, y) => {
          const trail = trails.get(bb.id) ?? [];
          trail.push([x, y]);
          if (trail.length > 6) trail.shift();
          trails.set(bb.id, trail);
          trail.forEach(([tx, ty], i) => {
            ctx.globalAlpha = (i + 1) / (trail.length * 2.5);
            ctx.fillStyle = '#3ef0ff';
            ctx.fillRect(Math.round(OX + tx) - 1, Math.round(OY + ty) - 1, 3, 3);
          });
          ctx.globalAlpha = bb.wait && Math.floor(performance.now() / 150) % 2 ? 0.4 : 1;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(Math.round(OX + x) - 2, Math.round(OY + y) - 2, 5, 5);
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
        ctx.fillRect(x, y, 4, 16);
        ctx.globalAlpha = 1;
        drawText(ctx, e.slot === core.mySlot() ? 'JIJ' : core.name(e.slot).slice(0, 10), x + 8, y, { color: e.alive ? '#ffffff' : '#8a8fb8' });
        drawText(ctx, e.side >= 0 ? SIDE_NAMES[e.side] : '', x + 8, y + 9, { color: '#a3a8d6' });
        for (let k = 0; k < Math.min(e.lives, 9); k++) {
          ctx.fillStyle = e.alive ? '#ff4d6d' : '#3a3440';
          ctx.fillRect(x + 8 + k * 6, y + 19, 4, 4);
        }
        if (!e.alive) drawText(ctx, 'AF', x + 8, y + 19, { color: '#ff4d6d' });
      });
      if (s.phase === ARCADE_PHASE.COUNTDOWN) {
        drawText(ctx, String(Math.max(1, Math.ceil(core.secondsLeft()))), OX + S / 2, 64, { color: '#ffe14d', scale: 5, align: 'center', shadow: '#ff3ea5' });
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

function drawField() {
  const { canvas, ctx } = createLayer(320, 180);
  ctx.fillStyle = '#0b0b1e';
  ctx.fillRect(0, 0, 320, 180);
  ctx.fillStyle = '#12122e';
  ctx.fillRect(OX, OY, S, S);
  ctx.fillStyle = '#1b1b48';
  for (let i = 8; i < S; i += 16) {
    ctx.fillRect(OX + i, OY, 1, S);
    ctx.fillRect(OX, OY + i, S, 1);
  }
  ctx.fillStyle = '#ff3ea5';
  const c = PF.corner;
  for (const [x, y] of [[0, 0], [S - c, 0], [0, S - c], [S - c, S - c]]) ctx.fillRect(OX + x, OY + y, c, c);
  ctx.fillStyle = '#0b0b1e';
  for (const [x, y] of [[0, 0], [S - c, 0], [0, S - c], [S - c, S - c]]) ctx.fillRect(OX + x + 2, OY + y + 2, c - 4, c - 4);
  ctx.strokeStyle = '#3ef0ff';
  ctx.strokeRect(OX - 0.5, OY - 0.5, S + 1, S + 1);
  return canvas;
}

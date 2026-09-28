// Stenenbreker (client side): your paddle is predicted; balls, bricks and
// capsules come from the server. Space / A launches your ball.
import { BTN } from '../../../shared/messages.js';
import { BF, BRICK, CAPS, brickX, brickY, stepBreakoutPaddle } from '../../../shared/games/breakout.js';
import { createArcadeCore, ARCADE_PHASE, lerp } from '../common/arcade.js';
import { Predictor } from '../../js/core/predict.js';
import { drawText, roundRect } from '../../js/core/hudtext.js';
import { createFx } from '../../js/core/fx.js';
import { createSharpLayer } from '../../js/core/canvas.js';

export const meta = { width: 320, height: 180, pixelated: false, step: 1 / 30, touchButtons: [{ label: 'START', bit: BTN.A }] };

const SHADOW = '#0b0b1e';
// Stone and brick colours per row (terracotta, ochre, sandstone, moss, slate, ...).
const ROW_COLORS = ['#b5553c', '#c9784e', '#d9b77a', '#8a9a5a', '#6f8196', '#9a8f86', '#c99a3a', '#9a3a2a'];

function decode(r, time) {
  const s = { time, phase: r.u8(), endsAt: 0, level: 0, lives: 0, slow: false, ents: [], balls: [], bricks: null, caps: [] };
  s.endsAt = time + r.f32() * 1000;
  s.level = r.u8();
  s.lives = r.u8();
  s.slow = r.u8() === 1;
  const n = r.u8();
  for (let i = 0; i < n; i++) s.ents.push({ slot: r.u8(), flags: r.u8(), ack: r.u16(), p: r.f32(), wide: r.f32(), score: r.u16() });
  const m = r.u8();
  for (let i = 0; i < m; i++) s.balls.push({ id: r.u16(), owner: r.u8(), attached: r.u8() === 1, x: r.i16() / 8, y: r.i16() / 8 });
  s.bricks = new Uint8Array(BF.cols * BF.rows);
  for (let i = 0; i < s.bricks.length; i++) s.bricks[i] = r.u8();
  const c = r.u8();
  for (let i = 0; i < c; i++) s.caps.push({ x: r.i16() / 4, y: r.i16() / 4, type: r.u8() });
  return s;
}

export function createGame() {
  const predictor = new Predictor({
    create: () => ({ p: BF.width / 2, wide: 0 }),
    copy: (d, s) => { d.p = s.p; d.wide = s.wide; },
    step: (s, inp) => stepBreakoutPaddle(s, inp.ax, 1 / 30),
    smoothKeys: ['p'],
  });
  const core = createArcadeCore({ decode, predictor, toServer: (e, out) => { out.p = e.p; out.wide = e.wide; } });
  let ctx, input, sfx, fx, bg;
  let banner = null;

  return {
    mount(view, net, c) {
      ctx = view.ctx;
      input = c.input;
      sfx = c.sfx;
      core.mount(net, c);
      fx = createFx({ reducedMotion: c.reducedMotion, smooth: true });
      bg = createSharpLayer(view, drawBackground);
      // Mouse / touch: the paddle follows the pointer horizontally.
      view.canvas.addEventListener('pointermove', (e) => {
        const p = view.toLogical(e.clientX, e.clientY);
        this.pointerX = p.x;
        this.pointerAt = performance.now();
      });
      view.canvas.addEventListener('pointerdown', (e) => {
        const p = view.toLogical(e.clientX, e.clientY);
        this.pointerX = p.x;
        this.pointerAt = performance.now();
        this.clicked = true;
      });
    },

    onSnapshot(snap) {
      core.onSnapshot(snap);
    },

    onEvent(msg) {
      const slot = core.mySlot();
      switch (msg.e) {
        case 'go': sfx.play('go'); banner = null; break;
        case 'brick':
          sfx.play(msg.s === slot ? 'hit' : 'click');
          fx.burst(msg.x, msg.y, core.hex(msg.s), 10, { speed: 50, life: 0.45 });
          break;
        case 'crack': sfx.play('click'); fx.burst(msg.x, msg.y, '#ffffff', 5, { speed: 30, life: 0.3 }); break;
        case 'steel': sfx.play('click'); break;
        case 'paddle': if (msg.s === slot) sfx.play('ready'); break;
        case 'launch': if (msg.s === slot) sfx.play('shoot'); break;
        case 'cap':
          sfx.play('coin');
          fx.text(`${CAPS[msg.type].key === 'wide' ? 'BREED' : CAPS[msg.type].key === 'multi' ? 'MULTIBAL' : CAPS[msg.type].key === 'slow' ? 'TRAAG' : '+1 LEVEN'}`, 160, 120, CAPS[msg.type].color, 1, 1.2);
          break;
        case 'lost': if (msg.s === slot) { sfx.play('lose'); fx.shake(4); } break;
        case 'roundEnd': banner = { text: 'MUUR KAPOT!', sub: `OP NAAR LEVEL ${msg.level + 1}` }; sfx.play('win'); break;
        case 'end': banner = msg.win ? { text: 'GEWONNEN!', sub: 'ALLE MUREN ZIJN KAPOT' } : { text: 'GAME OVER', sub: '' }; sfx.play(msg.win ? 'win' : 'lose'); break;
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
      let ax = inp.ax;
      // Pointer control: steer towards the pointer when it moved recently.
      if (this.pointerAt && performance.now() - this.pointerAt < 3000 && predictor.ready && !ax) {
        const diff = this.pointerX - predictor.state.p;
        ax = Math.abs(diff) < 1 ? 0 : Math.max(-1, Math.min(1, diff / 8));
      }
      let buttons = inp.buttons;
      if (this.clicked) {
        buttons |= BTN.A;
        this.clicked = false;
      }
      if (core.latest?.phase === ARCADE_PHASE.PLAY && core.mine() && predictor.ready) core.send(ax, 0, buttons);
      else core.idle();
    },

    render(alpha) {
      ctx.save();
      ctx.translate(fx.shakeX(), fx.shakeY());
      bg.blit(ctx);
      const s = core.latest;
      const sample = core.sample();
      if (s) {
        for (let i = 0; i < s.bricks.length; i++) {
          const v = s.bricks[i];
          if (!v) continue;
          const col = i % BF.cols;
          const row = Math.floor(i / BF.cols);
          const x = brickX(col);
          const y = brickY(row);
          const color = v === BRICK.STEEL ? '#7a7f88' : v === BRICK.TOUGH ? '#d8d2c8' : ROW_COLORS[row % ROW_COLORS.length];
          // A stone with a little bevel and some speckles.
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          roundRect(ctx, x + 0.3, y + 0.6, BF.brickW, BF.brickH, 1.2);
          ctx.fill();
          const g = ctx.createLinearGradient(0, y, 0, y + BF.brickH);
          g.addColorStop(0, color);
          g.addColorStop(1, shade(color, 0.78));
          ctx.fillStyle = g;
          roundRect(ctx, x, y, BF.brickW, BF.brickH, 1.2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.28)';
          ctx.fillRect(x + 1, y + 0.4, BF.brickW - 2, 0.6);
          ctx.fillStyle = 'rgba(0,0,0,0.16)';
          for (let k = 0; k < 4; k++) {
            ctx.beginPath();
            ctx.arc(x + ((i * 7 + k * 5) % (BF.brickW - 2)) + 1, y + ((i * 3 + k * 2) % (BF.brickH - 2)) + 1, 0.45, 0, Math.PI * 2);
            ctx.fill();
          }
          if (v === BRICK.TOUGH) {
            ctx.fillStyle = ROW_COLORS[row % ROW_COLORS.length];
            roundRect(ctx, x + 1.8, y + 1.8, BF.brickW - 3.6, BF.brickH - 3.6, 0.8);
            ctx.fill();
          } else if (v === BRICK.STEEL) {
            ctx.fillStyle = '#b8bdc6'; // rivets
            for (const [rx, ry] of [[1.3, 1.3], [BF.brickW - 1.3, 1.3], [1.3, BF.brickH - 1.3], [BF.brickW - 1.3, BF.brickH - 1.3]]) {
              ctx.beginPath();
              ctx.arc(x + rx, y + ry, 0.55, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        for (const c of s.caps) {
          const cap = CAPS[c.type];
          // A pill-shaped capsule with its letter.
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          roundRect(ctx, c.x - 7.5, c.y - 3.5, 16, 9, 4.5);
          ctx.fill();
          ctx.fillStyle = cap.color;
          roundRect(ctx, c.x - 8, c.y - 4.5, 16, 9, 4.5);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          roundRect(ctx, c.x - 6, c.y - 3.6, 12, 2, 1);
          ctx.fill();
          drawText(ctx, cap.label, c.x, c.y - 3.8, { color: '#2a1a10', align: 'center' });
        }
      }
      if (s && sample) {
        const a = sample.a.state;
        for (const eb of sample.b.state.ents) {
          const ea = core.find(a.ents, eb.slot) ?? eb;
          const me = eb.slot === core.mySlot() && predictor.ready;
          const p = me ? predictor.get('p', alpha) : lerp(ea.p, eb.p, sample.t);
          const wide = me ? predictor.state.wide : eb.wide;
          const w = wide > 0 ? BF.wideW : BF.paddleW;
          // Paddle: a wooden plank with a band in the player's colour.
          ctx.fillStyle = 'rgba(0,0,0,0.4)';
          roundRect(ctx, p - w / 2 + 0.6, BF.paddleY + 1, w, BF.paddleH, BF.paddleH / 2);
          ctx.fill();
          ctx.fillStyle = '#c8945a';
          roundRect(ctx, p - w / 2, BF.paddleY, w, BF.paddleH, BF.paddleH / 2);
          ctx.fill();
          ctx.fillStyle = core.hex(eb.slot);
          roundRect(ctx, p - w / 2 + 2, BF.paddleY + 0.7, w - 4, BF.paddleH - 1.4, (BF.paddleH - 1.4) / 2);
          ctx.fill();
          if (me) {
            ctx.fillStyle = '#ffffff';
            roundRect(ctx, p - 3, BF.paddleY + BF.paddleH / 2 - 0.4, 6, 0.8, 0.4);
            ctx.fill();
          }
        }
        core.each(sample, 'balls', 'id', (bb, x, y) => {
          if (bb.attached) {
            const owner = bb.owner === core.mySlot() && predictor.ready ? predictor.get('p', alpha) : x;
            x = owner;
          }
          // A shiny ball in the owner's colour
          const g = ctx.createRadialGradient(x - 0.7, y - 0.7, 0.2, x, y, 2.2);
          g.addColorStop(0, '#ffffff');
          g.addColorStop(0.45, core.hex(bb.owner));
          g.addColorStop(1, shade(core.hex(bb.owner), 0.6));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      fx.drawParticles(ctx);
      if (s) this.hud(s);
      fx.drawTexts(ctx);
      ctx.restore();
    },

    hud(s) {
      drawText(ctx, `LEVEL ${Math.min(s.level + 1, 3)}`, 4, 2, { color: '#ffffff', shadow: SHADOW });
      drawText(ctx, `LEVENS ${s.lives}`, 60, 2, { color: '#ff8a7a', shadow: SHADOW });
      if (s.slow) drawText(ctx, 'TRAAG', 118, 2, { color: '#8ad88a', shadow: SHADOW });
      let x = 316;
      for (const e of [...s.ents].sort((p, q) => p.score - q.score)) {
        const w = drawText(ctx, String(e.score), x, 2, { color: '#ffffff', align: 'right', shadow: SHADOW });
        ctx.fillStyle = core.hex(e.slot);
        roundRect(ctx, x - w - 6.5, 2.5, 4.5, 4.5, 1);
        ctx.fill();
        x -= w + 12;
      }
      if (s.phase === ARCADE_PHASE.COUNTDOWN) {
        drawText(ctx, `LEVEL ${s.level + 1}`, 160, 96, { color: '#ffe14d', scale: 3, align: 'center', shadow: '#5a3f28' });
        drawText(ctx, 'SPATIE OF TIK OM TE SCHIETEN', 160, 128, { color: '#ffffff', align: 'center', shadow: SHADOW });
      } else if (banner && s.phase !== ARCADE_PHASE.PLAY) {
        drawText(ctx, banner.text, 160, 96, { color: '#ffe14d', scale: 3, align: 'center', shadow: '#5a3f28' });
        if (banner.sub) drawText(ctx, banner.sub, 160, 124, { color: '#ffffff', align: 'center', shadow: SHADOW });
      }
    },

    unmount() {},
  };
}

// A dim castle wall of big stone blocks, a wooden beam for the HUD.
function drawBackground(ctx) {
  ctx.fillStyle = '#1a1614';
  ctx.fillRect(0, 0, BF.width, BF.height);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = BF.top, row = 0; y < BF.height; y += 12, row++) {
    for (let x = row % 2 ? -12 : 0; x < BF.width; x += 24) {
      const v = 38 + Math.floor(rnd() * 10);
      ctx.fillStyle = `rgb(${v}, ${v - 5}, ${v - 9})`;
      roundRect(ctx, x + 0.6, y + 0.6, 22.8, 10.8, 1.5);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(x + 1.5, y + 1, 21, 1);
    }
  }
  // Torch light from above
  const g = ctx.createRadialGradient(BF.width / 2, BF.top, 10, BF.width / 2, BF.top, 200);
  g.addColorStop(0, 'rgba(255, 190, 110, 0.12)');
  g.addColorStop(1, 'rgba(255, 190, 110, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, BF.top, BF.width, BF.height);
  ctx.fillStyle = '#5a3f28';
  ctx.fillRect(0, 0, BF.width, BF.top - 1);
  ctx.fillStyle = '#4a3320';
  for (let x = 6; x < BF.width; x += 40) ctx.fillRect(x, 1, 18, 0.6);
  ctx.fillStyle = '#3e2a1a';
  ctx.fillRect(0, BF.top - 2, BF.width, 2);
}

// Darker version of a hex colour.
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = [16, 8, 0].map((sh) => Math.round(((n >> sh) & 255) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

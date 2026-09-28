// Slangenstrijd (client side): steer with arrows/WASD, stick or swipe-ish
// joystick. Snakes glide smoothly between grid cells (interpolated).
import { SNAKE_GRID as G, dirFromAxes, unpackBody } from '../../../shared/games/snake.js';
import { createArcadeCore, ARCADE_PHASE, isConnected } from '../common/arcade.js';
import { drawText } from '../../js/core/pixelfont.js';
import { createFx } from '../../js/core/fx.js';
import { createLayer } from '../../js/core/canvas.js';

export const meta = { width: 320, height: 180, pixelated: true, step: 1 / 30, touchButtons: [] };

const SHADOW = '#0b0b1e';

function decode(r, time) {
  const s = { time, phase: r.u8(), endsAt: time + r.f32() * 1000, round: r.u8(), rounds: r.u8(), moves: r.u16(), ents: [], food: [] };
  const n = r.u8();
  for (let i = 0; i < n; i++) {
    const e = { slot: r.u8(), flags: r.u8(), alive: r.u8() === 1, dir: r.u8(), len: r.u16(), points: r.u16(), wins: r.u8() };
    const hx = r.u8();
    const hy = r.u8();
    const bytes = new Uint8Array(Math.ceil((e.len - 1) / 4));
    for (let k = 0; k < bytes.length; k++) bytes[k] = r.u8();
    e.cells = unpackBody(hx, hy, e.len, bytes);
    s.ents.push(e);
  }
  const f = r.u8();
  for (let i = 0; i < f; i++) s.food.push([r.u8(), r.u8()]);
  return s;
}

const px = (cx) => G.x0 + cx * G.cell;
const py = (cy) => G.y0 + cy * G.cell;

export function createGame() {
  const core = createArcadeCore({ decode });
  let ctx, input, sfx, fx, bg;
  let lastSent = -1;
  let banner = null;

  function drawSnake(cells, head, color, dark, alive, isMe) {
    ctx.globalAlpha = alive ? 1 : 0.35;
    // Segments as swept squares between consecutive points (smooth when the head moves).
    const pts = [head, ...cells.slice(1)];
    for (let i = pts.length - 1; i >= 1; i--) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i - 1];
      const x0 = Math.min(px(ax), px(bx));
      const y0 = Math.min(py(ay), py(by));
      const w = Math.abs(px(ax) - px(bx)) + G.cell;
      const h = Math.abs(py(ay) - py(by)) + G.cell;
      ctx.fillStyle = dark;
      ctx.fillRect(Math.round(x0), Math.round(y0), Math.round(w), Math.round(h));
      ctx.fillStyle = (i & 1) ? color : shade(color);
      ctx.fillRect(Math.round(x0) + 1, Math.round(y0) + 1, Math.round(w) - 2, Math.round(h) - 2);
    }
    const hx = Math.round(px(head[0]));
    const hy = Math.round(py(head[1]));
    ctx.fillStyle = dark;
    ctx.fillRect(hx - 1, hy - 1, G.cell + 2, G.cell + 2);
    ctx.fillStyle = color;
    ctx.fillRect(hx, hy, G.cell, G.cell);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(hx + 1, hy + 1, 2, 2);
    ctx.fillRect(hx + 3, hy + 1, 2, 2);
    ctx.fillStyle = SHADOW;
    ctx.fillRect(hx + 2, hy + 2, 1, 1);
    ctx.fillRect(hx + 4, hy + 2, 1, 1);
    if (isMe && alive) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(hx + 2, hy - 3, 2, 1);
    }
    ctx.globalAlpha = 1;
  }

  return {
    mount(view, net, c) {
      ctx = view.ctx;
      input = c.input;
      sfx = c.sfx;
      core.mount(net, c);
      fx = createFx({ reducedMotion: c.reducedMotion });
      bg = drawBackground();
    },

    onSnapshot(snap) {
      const prev = core.latest;
      const s = core.onSnapshot(snap);
      if (prev && prev.round !== s.round) core.reset();
    },

    onEvent(msg) {
      const slot = core.mySlot();
      switch (msg.e) {
        case 'go': sfx.play('go'); break;
        case 'eat':
          if (msg.s === slot) sfx.play('coin');
          fx.burst(px(msg.x) + 3, py(msg.y) + 3, '#ff4d6d', 8, { speed: 30, life: 0.4 });
          break;
        case 'die':
          sfx.play(msg.s === slot ? 'explode' : 'hit');
          fx.burst(px(msg.x) + 3, py(msg.y) + 3, core.hex(msg.s), 26, { speed: 60, life: 0.7 });
          fx.shake(msg.s === slot ? 5 : 2);
          break;
        case 'roundEnd':
          banner = msg.s >= 0 ? { text: msg.s === slot ? 'JIJ WINT!' : `${core.name(msg.s).toUpperCase()} WINT`, color: core.hex(msg.s) } : { text: 'GELIJKSPEL', color: '#ffffff' };
          sfx.play(msg.s === slot ? 'win' : 'countdown');
          break;
        case 'round': banner = null; break;
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
      const d = dirFromAxes(inp.ax, inp.ay);
      // Only send when the wanted direction changes.
      if (core.mySlot() >= 0 && core.latest?.phase === ARCADE_PHASE.PLAY && d !== lastSent) {
        core.send(inp.ax, inp.ay, 0);
        lastSent = d;
      }
    },

    render() {
      ctx.save();
      ctx.translate(fx.shakeX(), fx.shakeY());
      ctx.drawImage(bg, 0, 0);
      const s = core.latest;
      const sample = core.sample();
      if (s && sample) {
        const a = sample.a.state;
        const b = sample.b.state;
        const step = b.moves - a.moves === 1 ? sample.t : 1;
        for (const [x, y] of b.food) {
          ctx.fillStyle = '#ff4d6d';
          ctx.fillRect(px(x) + 1, py(y) + 1, 4, 4);
          ctx.fillStyle = '#5dff8a';
          ctx.fillRect(px(x) + 3, py(y), 1, 1);
          ctx.fillStyle = '#ffb3c1';
          ctx.fillRect(px(x) + 2, py(y) + 2, 1, 1);
        }
        for (const eb of b.ents) {
          const ea = core.find(a.ents, eb.slot);
          let head = eb.cells[0];
          if (ea && step < 1 && eb.alive && ea.cells[0]) {
            head = [ea.cells[0][0] + (eb.cells[0][0] - ea.cells[0][0]) * step, ea.cells[0][1] + (eb.cells[0][1] - ea.cells[0][1]) * step];
          }
          drawSnake(eb.cells, head, core.hex(eb.slot), SHADOW, eb.alive, eb.slot === core.mySlot());
        }
      }
      fx.drawParticles(ctx);
      fx.drawTexts(ctx);
      if (s) this.hud(s);
      ctx.restore();
    },

    hud(s) {
      drawText(ctx, `RONDE ${s.round}/${s.rounds}`, 4, 2, { color: '#ffffff', shadow: SHADOW });
      let x = 316;
      for (const e of [...s.ents].sort((p, q) => p.points - q.points)) {
        const label = `${e.points}`;
        const w = drawText(ctx, label, x, 2, { color: e.alive ? '#ffffff' : '#8a8fb8', align: 'right', shadow: SHADOW });
        ctx.fillStyle = core.hex(e.slot);
        ctx.globalAlpha = isConnected(e.flags) ? 1 : 0.4;
        ctx.fillRect(x - w - 6, 3, 4, 4);
        ctx.globalAlpha = 1;
        x -= w + 12;
      }
      if (s.phase === ARCADE_PHASE.COUNTDOWN) {
        drawText(ctx, String(Math.max(1, Math.ceil(core.secondsLeft()))), 160, 70, { color: '#ffe14d', scale: 5, align: 'center', shadow: '#ff3ea5' });
        drawText(ctx, 'EET APPELS, BOTS NERGENS TEGENAAN', 160, 112, { color: '#ffffff', align: 'center', shadow: SHADOW });
      } else if ((s.phase === ARCADE_PHASE.ROUND_END || s.phase === ARCADE_PHASE.END) && banner) {
        drawText(ctx, banner.text, 160, 72, { color: banner.color, scale: 3, align: 'center', shadow: SHADOW });
      } else if (core.mySlot() >= 0 && !core.mine()?.alive && s.phase === ARCADE_PHASE.PLAY) {
        drawText(ctx, 'JE BENT AF - KIJK MEE', 160, 84, { color: '#ff4d6d', align: 'center', shadow: SHADOW });
      }
    },

    unmount() {},
  };
}

function drawBackground() {
  const { canvas, ctx } = createLayer(320, 180);
  ctx.fillStyle = '#0b0b1e';
  ctx.fillRect(0, 0, 320, 180);
  for (let y = 0; y < G.rows; y++) {
    for (let x = 0; x < G.cols; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#12122e' : '#151535';
      ctx.fillRect(px(x), py(y), G.cell, G.cell);
    }
  }
  ctx.strokeStyle = '#3ef0ff';
  ctx.lineWidth = 1;
  ctx.strokeRect(G.x0 - 1.5, G.y0 - 1.5, G.cols * G.cell + 3, G.rows * G.cell + 3);
  return canvas;
}

function shade(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [16, 8, 0].map((sh) => Math.round(((n >> sh) & 255) * 0.78));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

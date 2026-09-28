// Slangenstrijd (client side): steer with arrows/WASD, stick or swipe-ish
// joystick. Snakes glide smoothly between grid cells (interpolated).
import { SNAKE_GRID as G, dirFromAxes, unpackBody } from '../../../shared/games/snake.js';
import { createArcadeCore, ARCADE_PHASE, isConnected } from '../common/arcade.js';
import { drawText } from '../../js/core/hudtext.js';
import { createFx } from '../../js/core/fx.js';
import { createSharpLayer } from '../../js/core/canvas.js';

export const meta = { width: 320, height: 180, pixelated: false, step: 1 / 30, touchButtons: [] };

const SHADOW = '#14240f';

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
const cxp = (cx) => px(cx) + G.cell / 2; // cell centre
const cyp = (cy) => py(cy) + G.cell / 2;

export function createGame() {
  const core = createArcadeCore({ decode });
  let ctx, input, sfx, fx, bg;
  let lastSent = -1;
  let banner = null;

  // A round snake: a thick line through the cell centres, a lighter belly
  // stripe, and a head with eyes looking where it goes.
  function drawSnake(cells, head, color, dir, alive, isMe) {
    ctx.save();
    ctx.globalAlpha = alive ? 1 : 0.35;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const pts = [head, ...cells.slice(1)];
    const path = () => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(cxp(x), cyp(y)) : ctx.moveTo(cxp(x), cyp(y))));
    };
    path();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = G.cell + 1.2;
    ctx.stroke();
    path();
    ctx.strokeStyle = color;
    ctx.lineWidth = G.cell - 0.2;
    ctx.stroke();
    path();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = G.cell * 0.28;
    ctx.stroke();
    // Head
    const hx = cxp(head[0]);
    const hy = cyp(head[1]);
    ctx.beginPath();
    ctx.arc(hx, hy, G.cell * 0.62, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][dir] ?? [1, 0]; // right, down, left, up
    for (const side of [-1, 1]) {
      const ex = hx + dx * 1.2 - dy * side * 1.5;
      const ey = hy + dy * 1.2 + dx * side * 1.5;
      ctx.beginPath();
      ctx.arc(ex, ey, 1.2, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex + dx * 0.45, ey + dy * 0.45, 0.6, 0, Math.PI * 2);
      ctx.fillStyle = '#1a1a1a';
      ctx.fill();
    }
    if (isMe && alive) {
      ctx.beginPath();
      ctx.moveTo(hx - 2, hy - 7.5);
      ctx.lineTo(hx + 2, hy - 7.5);
      ctx.lineTo(hx, hy - 5.5);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    ctx.restore();
  }

  function drawApple(x, y) {
    const ax = cxp(x);
    const ay = cyp(y) + 0.3;
    ctx.beginPath();
    ctx.arc(ax, ay, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = '#d62828';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ax - 0.9, ay - 0.9, 0.8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fill();
    ctx.strokeStyle = '#6b4a2e';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(ax, ay - 2.4);
    ctx.lineTo(ax + 0.4, ay - 3.6);
    ctx.stroke();
    ctx.fillStyle = '#3c8a45';
    ctx.beginPath();
    ctx.ellipse(ax + 1.4, ay - 3.2, 1.2, 0.6, -0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  return {
    mount(view, net, c) {
      ctx = view.ctx;
      input = c.input;
      sfx = c.sfx;
      core.mount(net, c);
      fx = createFx({ reducedMotion: c.reducedMotion, smooth: true });
      bg = createSharpLayer(view, drawBackground);
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
          fx.burst(px(msg.x) + 3, py(msg.y) + 3, '#d62828', 8, { speed: 30, life: 0.4 });
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
      bg.blit(ctx);
      const s = core.latest;
      const sample = core.sample();
      if (s && sample) {
        const a = sample.a.state;
        const b = sample.b.state;
        const step = b.moves - a.moves === 1 ? sample.t : 1;
        for (const [x, y] of b.food) drawApple(x, y);
        for (const eb of b.ents) {
          const ea = core.find(a.ents, eb.slot);
          let head = eb.cells[0];
          if (ea && step < 1 && eb.alive && ea.cells[0]) {
            head = [ea.cells[0][0] + (eb.cells[0][0] - ea.cells[0][0]) * step, ea.cells[0][1] + (eb.cells[0][1] - ea.cells[0][1]) * step];
          }
          drawSnake(eb.cells, head, core.hex(eb.slot), eb.dir, eb.alive, eb.slot === core.mySlot());
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
        drawText(ctx, String(Math.max(1, Math.ceil(core.secondsLeft()))), 160, 70, { color: '#ffe14d', scale: 5, align: 'center', shadow: '#2f6a2a' });
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

// A garden: checkered lawn inside a hedge of round bushes, soil for the HUD.
function drawBackground(ctx) {
  ctx.fillStyle = '#2f6a2a';
  ctx.fillRect(0, 0, 320, 180);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Hedge: overlapping round bushes around the lawn
  for (let i = 0; i < 420; i++) {
    const x = rnd() * 320;
    const y = rnd() * 180;
    const inLawn = x > G.x0 - 1 && x < G.x0 + G.cols * G.cell + 1 && y > G.y0 - 1 && y < G.y0 + G.rows * G.cell + 1;
    if (inLawn) continue;
    ctx.beginPath();
    ctx.arc(x, y, 2 + rnd() * 3, 0, Math.PI * 2);
    ctx.fillStyle = ['#2a6026', '#37772f', '#3f8a35'][i % 3];
    ctx.fill();
  }
  ctx.fillStyle = '#5a3f28';
  ctx.fillRect(0, 0, 320, G.y0 - 2);
  ctx.fillStyle = '#4a3320';
  for (let x = 3; x < 320; x += 11) ctx.fillRect(x, 2 + (x % 3), 2, 1);
  for (let y = 0; y < G.rows; y++) {
    for (let x = 0; x < G.cols; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#8cc152' : '#81b84a';
      ctx.fillRect(px(x), py(y), G.cell, G.cell);
    }
  }
  ctx.strokeStyle = '#74a843';
  ctx.lineWidth = 0.4;
  for (let i = 0; i < 260; i++) {
    const x = G.x0 + rnd() * G.cols * G.cell;
    const y = G.y0 + 1 + rnd() * (G.rows * G.cell - 2);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5), y - 1.4);
    ctx.stroke();
  }
  // Soft shadow of the hedge on the lawn
  const g = ctx.createLinearGradient(0, G.y0, 0, G.y0 + 5);
  g.addColorStop(0, 'rgba(0,0,0,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(G.x0, G.y0, G.cols * G.cell, 5);
}

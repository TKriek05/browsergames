// Rotsregen (client side): vector-style ships and rocks with wrap-around.
// Your ship is predicted (inertia included); the rest is interpolated.
import { BTN } from '../../../shared/messages.js';
import { stepShip, ROCKS_FIELD as F, wrapDelta } from '../../../shared/physics/rocks.js';
import { createArcadeCore, ARCADE_PHASE } from '../common/arcade.js';
import { Predictor } from '../../js/core/predict.js';
import { drawText } from '../../js/core/pixelfont.js';
import { createFx } from '../../js/core/fx.js';
import { createLayer } from '../../js/core/canvas.js';

export const meta = {
  width: 320, height: 180, pixelated: true, step: 1 / 30,
  touchButtons: [{ label: 'VUUR', bit: BTN.A }, { label: 'GAS', bit: BTN.B }],
};

const SHADOW = '#0b0b1e';
const ROCK_FILL = ['#7a6a5a', '#6e6660', '#86705a', '#6a6258'];
const ROCK_R = [15, 8, 4];
const KEYS = ['x', 'y', 'vx', 'vy', 'hx', 'hy'];

function decode(r, time) {
  const s = { time, phase: r.u8(), endsAt: 0, wave: 0, versus: false, ents: [], rocks: [], bullets: [] };
  s.endsAt = time + r.f32() * 1000;
  s.wave = r.u8();
  s.versus = r.u8() === 1;
  const n = r.u8();
  for (let i = 0; i < n; i++) {
    const e = { slot: r.u8(), flags: r.u8(), ack: r.u16() };
    for (const k of KEYS) e[k] = r.f32();
    const st = r.u8();
    e.alive = (st & 1) !== 0;
    e.safe = (st & 2) !== 0;
    e.thrust = (st & 4) !== 0;
    e.lives = r.u8();
    e.score = r.u16();
    s.ents.push(e);
  }
  const nr = r.u8();
  for (let i = 0; i < nr; i++) s.rocks.push({ id: r.u16(), size: r.u8(), seed: r.u8(), x: r.i16() / 8, y: r.i16() / 8 });
  const nb = r.u8();
  for (let i = 0; i < nb; i++) s.bullets.push({ x: r.i16() / 8, y: r.i16() / 8, slot: r.u8() });
  return s;
}

// Deterministic lumpy outline per rock seed.
const shapes = new Map();
function rockShape(seed, size) {
  const key = seed * 4 + size;
  if (!shapes.has(key)) {
    let a = seed * 7919 + 13;
    const rnd = () => {
      a = (a * 16807) % 2147483647;
      return a / 2147483647;
    };
    const pts = [];
    const n = size === 2 ? 7 : 10;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const rr = ROCK_R[size] * (0.72 + rnd() * 0.42);
      pts.push([Math.cos(ang) * rr, Math.sin(ang) * rr]);
    }
    shapes.set(key, pts);
  }
  return shapes.get(key);
}

// Interpolate on a wrapping axis.
const wrapLerp = (a, b, t, size) => {
  let v = a + wrapDelta(b - a, size) * t;
  if (v < 0) v += size;
  if (v >= size) v -= size;
  return v;
};

export function createGame() {
  const predictor = new Predictor({
    create: () => ({ x: 160, y: 90, vx: 0, vy: 0, hx: 0, hy: -1 }),
    copy: (d, s) => { for (const k of KEYS) d[k] = s[k]; },
    step: (s, inp) => stepShip(s, inp.ax, inp.ay < -0.5 || (inp.buttons & BTN.B) !== 0, 1 / 30),
  });
  const core = createArcadeCore({ decode, predictor, toServer: (e, out) => { for (const k of KEYS) out[k] = e[k]; } });
  let ctx, input, sfx, fx, bg;
  let banner = null;
  let time = 0;

  // Predicted position without sliding across the screen when it wraps.
  function wrapGet(key, alpha, size) {
    const a = predictor.prev[key];
    const b = predictor.state[key];
    let v = a + wrapDelta(b - a, size) * alpha + predictor.offset[key];
    v %= size;
    return v < 0 ? v + size : v;
  }

  // Draw something at (x, y) and again across the edges when it overlaps them.
  function wrapped(x, y, r, fn) {
    fn(x, y);
    const dx = x < r ? F.width : x > F.width - r ? -F.width : 0;
    const dy = y < r ? F.height : y > F.height - r ? -F.height : 0;
    if (dx) fn(x + dx, y);
    if (dy) fn(x, y + dy);
    if (dx && dy) fn(x + dx, y + dy);
  }

  function drawShip(x, y, hx, hy, color, thrust, blink) {
    if (blink && Math.floor(time * 10) % 2) return;
    const nx = -hy;
    const ny = hx;
    const p = (f, s) => [x + hx * f + nx * s, y + hy * f + ny * s];
    wrapped(x, y, 8, (cx, cy) => {
      const ox = cx - x;
      const oy = cy - y;
      const pts = [p(7, 0), p(-5, 4.5), p(-3, 0), p(-5, -4.5)];
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px + ox, py + oy) : ctx.moveTo(px + ox, py + oy)));
      ctx.closePath();
      ctx.stroke();
      if (thrust && Math.floor(time * 20) % 2) {
        const [fx1, fy1] = p(-4, 2);
        const [fx2, fy2] = p(-9, 0);
        const [fx3, fy3] = p(-4, -2);
        ctx.strokeStyle = '#ffd23e';
        ctx.beginPath();
        ctx.moveTo(fx1 + ox, fy1 + oy);
        ctx.lineTo(fx2 + ox, fy2 + oy);
        ctx.lineTo(fx3 + ox, fy3 + oy);
        ctx.stroke();
      }
    });
  }

  return {
    mount(view, net, c) {
      ctx = view.ctx;
      input = c.input;
      sfx = c.sfx;
      core.mount(net, c);
      fx = createFx({ max: 300, reducedMotion: c.reducedMotion });
      bg = drawStars();
    },

    onSnapshot(snap) {
      core.onSnapshot(snap);
    },

    onEvent(msg) {
      const slot = core.mySlot();
      switch (msg.e) {
        case 'go': sfx.play('go'); banner = null; break;
        case 'fire': if (msg.s === slot) sfx.play('shoot'); break;
        case 'rock':
          sfx.play(msg.size === 0 ? 'explode' : 'hit');
          fx.burst(msg.x, msg.y, '#9a8a78', msg.size === 0 ? 20 : 10, { speed: 45, life: 0.6 });
          break;
        case 'boom':
          sfx.play('explode');
          fx.burst(msg.x, msg.y, core.hex(msg.s), 34, { speed: 60, life: 0.9 });
          fx.shake(msg.s === slot ? 6 : 2);
          if (msg.by >= 0) fx.text(`${core.name(msg.by).toUpperCase()} RAAKT ${core.name(msg.s).toUpperCase()}`, 160, 40, core.hex(msg.by), 1, 1.6);
          break;
        case 'spawn': if (msg.s === slot) sfx.play('join'); break;
        case 'wave': fx.text(`GOLF ${msg.n}`, 160, 80, '#ffe14d', 3, 1.5); sfx.play('coin'); break;
        case 'end': banner = msg.s !== undefined && msg.s >= 0 ? { text: msg.s === slot ? 'JIJ WINT!' : `${core.name(msg.s).toUpperCase()} WINT`, color: core.hex(msg.s) } : { text: 'GAME OVER', color: '#ff4d6d' }; sfx.play('lose'); break;
        default: break;
      }
    },

    onReconnect() {
      core.reset();
    },

    update(dt) {
      time += dt;
      fx.update(dt);
      core.beep();
      const inp = input.sample();
      const me = core.mine();
      if (core.latest?.phase === ARCADE_PHASE.PLAY && me?.alive && predictor.ready) core.send(inp.ax, inp.ay, inp.buttons);
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
        const t = sample.t;
        // Rocks
        ctx.strokeStyle = '#3e342c';
        ctx.lineWidth = 1;
        for (const rb of b.rocks) {
          const ra = a.rocks.find((q) => q.id === rb.id) ?? rb;
          const x = wrapLerp(ra.x, rb.x, t, F.width);
          const y = wrapLerp(ra.y, rb.y, t, F.height);
          const pts = rockShape(rb.seed, rb.size);
          const spin = time * (((rb.id % 7) - 3) * 0.25);
          const c = Math.cos(spin);
          const sn = Math.sin(spin);
          wrapped(x, y, ROCK_R[rb.size] + 2, (cx, cy) => {
            ctx.beginPath();
            pts.forEach(([px, py], i) => {
              const rx = cx + px * c - py * sn;
              const ry = cy + px * sn + py * c;
              if (i) ctx.lineTo(rx, ry);
              else ctx.moveTo(rx, ry);
            });
            ctx.closePath();
            ctx.fillStyle = ROCK_FILL[rb.seed % ROCK_FILL.length];
            ctx.fill();
            ctx.stroke();
            // A crater or two
            ctx.fillStyle = 'rgba(40, 30, 24, 0.45)';
            const cr = ROCK_R[rb.size] * 0.28;
            ctx.fillRect(Math.round(cx + c * cr - 1), Math.round(cy + sn * cr - 1), 2 + rb.size, 2 + rb.size);
            if (rb.size > 0) ctx.fillRect(Math.round(cx - sn * cr * 1.4), Math.round(cy + c * cr * 1.2), 2, 2);
          });
        }
        // Bullets
        for (const bl of b.bullets) {
          ctx.fillStyle = core.hex(bl.slot);
          ctx.fillRect(Math.round(bl.x) - 1, Math.round(bl.y) - 1, 2, 2);
        }
        // Ships
        for (const eb of b.ents) {
          if (!eb.alive) continue;
          const ea = core.find(a.ents, eb.slot) ?? eb;
          const me = eb.slot === core.mySlot() && predictor.ready;
          let x, y, hx, hy;
          if (me) {
            x = wrapGet('x', alpha, F.width);
            y = wrapGet('y', alpha, F.height);
            hx = predictor.state.hx;
            hy = predictor.state.hy;
          } else {
            x = wrapLerp(ea.x, eb.x, t, F.width);
            y = wrapLerp(ea.y, eb.y, t, F.height);
            hx = eb.hx;
            hy = eb.hy;
          }
          const thrust = me ? input.state.ay < -0.5 || (input.state.buttons & BTN.B) !== 0 : eb.thrust;
          drawShip(x, y, hx, hy, core.hex(eb.slot), thrust, eb.safe);
        }
      }
      fx.drawParticles(ctx);
      if (s) this.hud(s);
      fx.drawTexts(ctx);
      ctx.restore();
    },

    hud(s) {
      drawText(ctx, `GOLF ${s.wave}`, 4, 2, { color: '#ffffff', shadow: SHADOW });
      let x = 316;
      for (const e of [...s.ents].sort((p, q) => p.score - q.score)) {
        const w = drawText(ctx, `${e.score}`, x, 2, { color: e.lives > 0 ? '#ffffff' : '#8a8fb8', align: 'right', shadow: SHADOW });
        ctx.fillStyle = core.hex(e.slot);
        for (let k = 0; k < Math.min(e.lives, 5); k++) ctx.fillRect(x - w - 6 - k * 4, 3, 3, 4);
        x -= w + 10 + Math.min(e.lives, 5) * 4;
      }
      if (s.phase === ARCADE_PHASE.COUNTDOWN) {
        drawText(ctx, String(Math.max(1, Math.ceil(core.secondsLeft()))), 160, 60, { color: '#ffe14d', scale: 5, align: 'center', shadow: '#3a2a5a' });
        drawText(ctx, s.versus ? 'IEDER VOOR ZICH!' : 'SAMEN DE ROTSEN KAPOT', 160, 100, { color: '#ffffff', align: 'center', shadow: SHADOW });
        drawText(ctx, 'DRAAIEN: LINKS/RECHTS  GAS: OMHOOG  VUUR: SPATIE', 160, 114, { color: '#a3a8d6', align: 'center', shadow: SHADOW });
      } else if (banner && s.phase === ARCADE_PHASE.END) {
        drawText(ctx, banner.text, 160, 80, { color: banner.color, scale: 3, align: 'center', shadow: SHADOW });
      } else {
        const me = core.mine();
        if (me && !me.alive) drawText(ctx, me.lives > 0 ? 'OPNIEUW IN 2 SEC...' : 'GEEN LEVENS MEER - KIJK MEE', 160, 150, { color: '#ff4d6d', align: 'center', shadow: SHADOW });
      }
    },

    unmount() {},
  };
}

// Deep space: a soft nebula, a distant ringed planet and many stars.
function drawStars() {
  const { canvas, ctx } = createLayer(F.width, F.height);
  ctx.fillStyle = '#05060e';
  ctx.fillRect(0, 0, F.width, F.height);
  for (const [x, y, r, color] of [[70, 50, 90, 'rgba(70, 40, 110, 0.35)'], [240, 130, 110, 'rgba(30, 60, 110, 0.3)'], [180, 40, 60, 'rgba(110, 50, 70, 0.2)']]) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(5, 6, 14, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, F.width, F.height);
  }
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = i % 9 === 0 ? '#f4ecd8' : i % 3 ? '#3a3e5a' : '#8a90b8';
    ctx.fillRect((i * 131 + (i >> 3)) % F.width, (i * 71 + i * i) % F.height, 1, 1);
  }
  // Ringed planet in the corner
  ctx.fillStyle = '#c9784e';
  ctx.beginPath();
  ctx.arc(282, 148, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#a85a38';
  ctx.fillRect(266, 146, 32, 3);
  ctx.fillRect(268, 153, 28, 2);
  ctx.strokeStyle = '#e8c89a';
  ctx.beginPath();
  ctx.ellipse(282, 148, 27, 6, -0.3, 0, Math.PI * 2);
  ctx.stroke();
  return canvas;
}

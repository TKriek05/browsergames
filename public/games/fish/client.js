// Hapvis (client side): the camera follows your fish (it zooms out as you
// grow). Your fish is predicted; the others are interpolated. Steer with the
// keys, a gamepad or the mouse (the fish swims towards the pointer).
// Power-up bubbles (optional) drift in the sea: see powers.js.
import { BTN } from '../../../shared/messages.js';
import { FISH, FISH_FLAG, FISH_POWER, FISH_POWERS, stepFish, fishRadius, planktonSpots, canEat } from '../../../shared/games/fish.js';
import { createArcadeCore, ARCADE_PHASE } from '../common/arcade.js';
import { Predictor } from '../../js/core/predict.js';
import { drawText, roundRect } from '../../js/core/hudtext.js';
import { makeDecor, drawWater, drawBottom, drawPlankton, drawFish } from './draw.js';
import { drawPowerBubble, drawFishAura, drawPowerHud, powerIcon } from './powers.js';

export const meta = {
  width: 480,
  height: 270,
  pixelated: false,
  step: FISH.DT,
  touchButtons: [{ label: 'HAP', bit: BTN.A }],
};

const SHADOW = '#082233';
const MOUSE_IDLE_MS = 2500;
const POWER_TIPS = {
  turbo: 'Je zwemt een tijdje sneller',
  spikes: 'Niemand kan je nu opeten',
  magnet: 'Je hapt plankton van veraf',
  double: 'Dubbele punten',
  grow: 'Je bent meteen een stuk groter',
};
const KEYS = ['x', 'y', 'vx', 'vy', 'mass', 'dash', 'cool', 'fx', 'fy', 'boost', 'prevA'];

function decode(r, time) {
  const s = { time, phase: r.u8(), endsAt: 0, seed: 0, ents: [], food: null, powers: [] };
  s.endsAt = time + r.f32() * 1000;
  s.seed = r.u32();
  const n = r.u8();
  for (let i = 0; i < n; i++) {
    const slot = r.u8();
    const flags = r.u8();
    s.ents.push({
      slot, flags, ack: r.u16(),
      x: r.f32(), y: r.f32(), vx: r.f32(), vy: r.f32(), mass: r.f32(), dash: r.f32(), cool: r.f32(), fx: r.f32(), fy: r.f32(), boost: r.f32(), prevA: r.u8(),
      score: r.u16(), respawn: r.u8() / 10, spikes: r.u8() / 10, magnet: r.u8() / 10, double: r.u8() / 10,
      alive: (flags & FISH_FLAG.ALIVE) !== 0,
    });
  }
  const food = new Uint8Array(FISH.PLANKTON);
  for (let b = 0; b < FISH.PLANKTON / 8; b++) {
    const v = r.u8();
    for (let k = 0; k < 8; k++) food[b * 8 + k] = (v >> k) & 1;
  }
  s.food = food;
  const m = r.u8();
  for (let i = 0; i < m; i++) s.powers.push({ id: r.u8(), type: r.u8(), x: r.u16(), y: r.u16(), age: r.u8() / 4 });
  return s;
}

export function createGame() {
  let view, ctx, input, sfx, reduced;
  let spots = null;
  let decor = null;
  let seed = -1;
  let time = 0;
  let banner = null;
  const cam = { x: FISH.WIDTH / 2, y: FISH.HEIGHT / 2, zoom: 0.5 };
  const mouse = { x: 0, y: 0, at: 0, down: false };
  const bubbles = [];
  const cleanups = [];
  const aura = { boost: 0, spikes: 0, magnet: 0 };
  const hud = { boost: 0, spikes: 0, magnet: 0, double: 0 };
  const predictor = new Predictor({
    create: () => ({ x: 0, y: 0, vx: 0, vy: 0, mass: FISH.START_MASS, dash: 0, cool: 0, fx: 1, fy: 0, boost: 0, prevA: 0 }),
    copy: (d, s) => { for (const k of KEYS) d[k] = s[k]; },
    step: (s, inp) => stepFish(s, inp.ax, inp.ay, inp.buttons & BTN.A, FISH.DT),
  });
  const core = createArcadeCore({ decode, predictor, toServer: (m, o) => { for (const k of KEYS) o[k] = m[k]; } });
  const now = () => performance.now() / 1000;

  function bubble(x, y, n = 1) {
    if (reduced) return;
    for (let i = 0; i < n; i++) bubbles.push({ x: x + (Math.random() - 0.5) * 8, y, r: 1 + Math.random() * 2.5, life: 1.5 + Math.random() });
    if (bubbles.length > 200) bubbles.splice(0, bubbles.length - 200);
  }

  return {
    mount(v, net, c) {
      view = v;
      ctx = v.ctx;
      input = c.input;
      sfx = c.sfx;
      reduced = c.reducedMotion;
      core.mount(net, c);
      const canvas = view.canvas;
      const move = (e) => {
        if (e.pointerType === 'touch') return;
        const p = view.toLogical(e.clientX, e.clientY);
        mouse.x = p.x;
        mouse.y = p.y;
        mouse.at = performance.now();
      };
      const down = (e) => {
        if (e.pointerType === 'touch') return;
        move(e);
        mouse.down = true;
      };
      const up = () => { mouse.down = false; };
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerdown', down);
      window.addEventListener('pointerup', up);
      cleanups.push(() => {
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerdown', down);
        window.removeEventListener('pointerup', up);
      });
    },

    onSnapshot(snap) {
      core.onSnapshot(snap);
      const L = core.latest;
      if (L.seed !== seed) {
        seed = L.seed;
        spots = planktonSpots(seed);
        decor = makeDecor(seed);
      }
    },

    onEvent(msg) {
      const me = core.mySlot();
      if (msg.e === 'go') sfx.play('go');
      else if (msg.e === 'gulp') {
        bubble(msg.x, msg.y, 14);
        sfx.play('pop');
        if (msg.s === me) banner = { text: 'HAP!', sub: `${core.name(msg.v)} opgegeten (+${msg.m})`, color: '#ffe14d', until: now() + 1.4 };
        else if (msg.v === me) {
          banner = { text: 'OPGEGETEN!', sub: `door ${core.name(msg.s)}`, color: '#ff7a7a', until: now() + 2.4 };
          sfx.play('lose');
        }
      } else if (msg.e === 'power') {
        bubble(msg.x, msg.y, 10);
        if (msg.s === me) {
          const p = FISH_POWERS[msg.type];
          banner = { text: p.name.toUpperCase() + '!', sub: POWER_TIPS[p.id], color: p.color, until: now() + 1.6 };
          sfx.play('item');
        } else sfx.play('plop');
      } else if (msg.e === 'spiked') {
        bubble(msg.x, msg.y, 8);
        if (msg.s === me) {
          banner = { text: 'AU!', sub: `${core.name(msg.v)} heeft stekels`, color: '#c38bff', until: now() + 1.4 };
          sfx.play('hit');
        } else if (msg.v === me) sfx.play('thud');
      } else if (msg.e === 'spawn' && msg.s === me) {
        predictor.reset();
        sfx.play('join');
      } else if (msg.e === 'end') sfx.play('win');
    },

    onReconnect() {
      core.reset();
    },

    update(dt) {
      time += dt;
      core.beep();
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        b.life -= dt;
        b.y -= (18 + b.r * 6) * dt;
        b.x += Math.sin(time * 3 + i) * 6 * dt;
        if (b.life <= 0 || b.y < 0) bubbles.splice(i, 1);
      }
      const L = core.latest;
      const mine = core.mine();
      const inp = input.sample();
      if (!L || L.phase !== ARCADE_PHASE.PLAY || !mine?.alive || !predictor.ready) {
        core.idle();
        return;
      }
      let ax = inp.ax;
      let ay = inp.ay;
      // Mouse steering: swim towards the pointer (world position).
      if (!ax && !ay && performance.now() - mouse.at < MOUSE_IDLE_MS) {
        const wx = (mouse.x - view.width / 2) / cam.zoom + cam.x;
        const wy = (mouse.y - view.height / 2) / cam.zoom + cam.y;
        const dx = wx - predictor.state.x;
        const dy = wy - predictor.state.y;
        const d = Math.hypot(dx, dy);
        const r = fishRadius(predictor.state.mass);
        if (d > r * 0.6) {
          const k = Math.min(1, d / (r * 4));
          ax = (dx / d) * k;
          ay = (dy / d) * k;
        }
      }
      const cool = predictor.state.cool;
      core.send(ax, ay, inp.buttons | (mouse.down ? BTN.A : 0));
      if (predictor.state.cool > cool + 0.5) {
        sfx.play('boost');
        bubble(predictor.state.x, predictor.state.y, 8);
      }
    },

    render(alpha) {
      const W = view.width;
      const H = view.height;
      ctx.fillStyle = '#082233';
      ctx.fillRect(0, 0, W, H);
      const L = core.latest;
      if (!L || !spots) return;
      const me = core.mySlot();
      const mine = core.mine();
      const alive = !!mine?.alive && predictor.ready;
      // Camera: follow your fish (zoom out as it grows), or show the whole sea.
      let tx = FISH.WIDTH / 2;
      let ty = FISH.HEIGHT / 2;
      let tz = Math.min(W / FISH.WIDTH, H / FISH.HEIGHT);
      if (alive) {
        tx = predictor.get('x', alpha);
        ty = predictor.get('y', alpha);
        tz = 1.15 * (14 / (14 + fishRadius(predictor.state.mass) * 0.55));
      } else if (mine) {
        tx = mine.x;
        ty = mine.y;
        tz = cam.zoom;
      }
      const k = cam.ready ? 0.12 : 1;
      cam.x += (tx - cam.x) * (alive ? 1 : k);
      cam.y += (ty - cam.y) * (alive ? 1 : k);
      cam.zoom += (tz - cam.zoom) * 0.08;
      cam.ready = true;
      const halfW = W / 2 / cam.zoom;
      const halfH = H / 2 / cam.zoom;
      // Keep the view inside the sea where possible.
      const clampTo = (v, half, size) => (size <= half * 2 ? size / 2 : Math.max(half, Math.min(size - half, v)));
      cam.x = clampTo(cam.x, halfW, FISH.WIDTH);
      cam.y = clampTo(cam.y, halfH, FISH.HEIGHT);
      const vis = { x0: cam.x - halfW - 10, x1: cam.x + halfW + 10, y0: cam.y - halfH - 10, y1: cam.y + halfH + 10 };

      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.x, -cam.y);
      drawWater(ctx, decor, time);
      drawBottom(ctx, decor, time);
      drawPlankton(ctx, spots, L.food, time, vis);
      for (const p of L.powers) drawPowerBubble(ctx, p, time);
      ctx.fillStyle = 'rgba(220, 240, 255, 0.45)';
      for (const b of bubbles) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }
      const myMass = alive ? predictor.state.mass : mine?.mass ?? 0;
      const labels = [];
      const sample = core.sample();
      core.each(sample, 'ents', 'slot', (eb, x, y) => {
        if (!eb.alive) return;
        const isMe = eb.slot === me && alive;
        const s = isMe ? predictor.state : eb;
        const px = isMe ? predictor.get('x', alpha) : x;
        const py = isMe ? predictor.get('y', alpha) : y;
        const r = fishRadius(s.mass);
        if (px < vis.x0 - r || px > vis.x1 + r || py < vis.y0 - r || py > vis.y1 + r) return;
        let ring = null;
        if (!isMe && myMass) ring = canEat({ mass: myMass }, s) ? 'rgba(157, 240, 176, 0.9)' : canEat(s, { mass: myMass }) ? 'rgba(255, 110, 110, 0.9)' : null;
        aura.boost = s.boost;
        aura.spikes = eb.spikes;
        aura.magnet = eb.magnet;
        drawFishAura(ctx, px, py, r, s.fx, s.fy, aura, time);
        if (ring && eb.spikes > 0) ring = null; // nobody can eat a spiky fish
        drawFish(ctx, px, py, r, s.fx, s.fy, core.hex(eb.slot), time, ring);
        if ((s.dash > 0 || s.boost > 0) && Math.random() < 0.6) bubble(px - s.fx * r, py - s.fy * r, 1);
        labels.push([px, py - r - 4, eb.slot, Math.round(s.mass), eb.double > 0]);
      });
      ctx.restore();

      // --- HUD ---
      for (const [x, y, slot, mass, double] of labels) {
        const sx = (x - cam.x) * cam.zoom + W / 2;
        const syy = (y - cam.y) * cam.zoom + H / 2;
        const w = drawText(ctx, `${core.name(slot)} ${mass}`, sx, syy - 9, { color: '#ffffff', scale: 0.85, align: 'center', shadow: SHADOW });
        if (double) powerIcon(ctx, FISH_POWER.DOUBLE, sx + w / 2 + 8, syy - 5, 4);
      }
      const left = core.secondsLeft();
      if (L.phase === ARCADE_PHASE.PLAY) drawText(ctx, `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`, W / 2, 5, { color: '#ffffff', scale: 1.5, align: 'center', shadow: SHADOW });
      [...L.ents].sort((a, b) => b.score - a.score).forEach((e, i) => {
        const y = 5 + i * 10;
        drawText(ctx, `${core.name(e.slot).slice(0, 10)} ${e.score}`, W - 6, y, { color: e.slot === me ? '#ffe14d' : '#ffffff', scale: 0.85, align: 'right', shadow: SHADOW });
      });
      // Minimap.
      const mw = 72;
      const mh = 48;
      const mx0 = W - mw - 6;
      const my0 = H - mh - 6;
      ctx.fillStyle = 'rgba(8, 34, 51, 0.6)';
      roundRect(ctx, mx0, my0, mw, mh, 5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(200, 230, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.strokeRect(mx0 + ((cam.x - halfW) / FISH.WIDTH) * mw, my0 + ((cam.y - halfH) / FISH.HEIGHT) * mh, ((halfW * 2) / FISH.WIDTH) * mw, ((halfH * 2) / FISH.HEIGHT) * mh);
      for (const e of L.ents) {
        if (!e.alive) continue;
        ctx.fillStyle = core.hex(e.slot);
        ctx.beginPath();
        ctx.arc(mx0 + (e.x / FISH.WIDTH) * mw, my0 + (e.y / FISH.HEIGHT) * mh, Math.max(1.5, fishRadius(e.mass) * 0.1) + (e.slot === me ? 0.8 : 0), 0, Math.PI * 2);
        ctx.fill();
      }
      if (alive) {
        drawText(ctx, `Gewicht ${Math.round(predictor.state.mass)}`, 6, H - 22, { color: '#ffffff', scale: 1.1, shadow: SHADOW });
        hud.boost = predictor.state.boost;
        hud.spikes = mine.spikes;
        hud.magnet = mine.magnet;
        hud.double = mine.double;
        drawPowerHud(ctx, hud, 6, H - 42, SHADOW);
        const cool = predictor.state.cool / FISH.DASH_COOLDOWN_S;
        ctx.fillStyle = 'rgba(8, 34, 51, 0.6)';
        roundRect(ctx, 6, H - 10, 60, 5, 2.5);
        ctx.fill();
        ctx.fillStyle = cool > 0 ? '#8fb2c6' : '#ffe14d';
        roundRect(ctx, 6, H - 10, 60 * Math.max(0.06, 1 - cool), 5, 2.5);
        ctx.fill();
      }
      const t = now();
      if (L.phase === ARCADE_PHASE.COUNTDOWN) {
        drawText(ctx, String(Math.max(1, Math.ceil(left))), W / 2, H / 2 - 40, { color: '#ffffff', scale: 5, align: 'center', shadow: SHADOW });
        drawText(ctx, 'HAP ZE OP!', W / 2, H / 2 + 4, { color: '#ffe14d', scale: 1.5, align: 'center', shadow: SHADOW });
      } else if (L.phase === ARCADE_PHASE.END) drawText(ctx, 'EINDE!', W / 2, H / 2 - 30, { color: '#ffe14d', scale: 3, align: 'center', shadow: SHADOW });
      else if (banner && t < banner.until) {
        drawText(ctx, banner.text, W / 2, H / 2 - 44, { color: banner.color, scale: 2.6, align: 'center', shadow: SHADOW });
        drawText(ctx, banner.sub, W / 2, H / 2 - 16, { color: '#ffffff', align: 'center', shadow: SHADOW });
      } else if (mine && !mine.alive) drawText(ctx, `Terug over ${Math.max(1, Math.ceil(mine.respawn))}…`, W / 2, H / 2, { color: '#ffffff', scale: 1.4, align: 'center', shadow: SHADOW });
      else if (me < 0) drawText(ctx, 'JE KIJKT MEE', W / 2, H - 16, { color: '#ffffff', align: 'center', shadow: SHADOW });
    },

    unmount() {
      for (const fn of cleanups) fn();
      core.reset();
    },
  };
}

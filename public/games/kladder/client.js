// Kladderkoning (client side): the canvas seen from above. Your painter is
// predicted with the shared movement; the others are interpolated. The paint
// grid is kept here from the snapshots (recent changes + one full strip each
// time) and drawn as soft blobs on a layer that is only redrawn when it changed.
import { BTN } from '../../../shared/messages.js';
import { KL, KL_CELLS, KL_FLAG, KL_MAPS, KL_MAP_IDS, KL_POWER, KL_POWERS, stepPainter, mapWalls } from '../../../shared/games/kladder.js';
import { createArcadeCore, ARCADE_PHASE } from '../common/arcade.js';
import { Predictor } from '../../js/core/predict.js';
import { createFx } from '../../js/core/fx.js';
import { createSharpLayer } from '../../js/core/canvas.js';
import { drawText, roundRect } from '../../js/core/hudtext.js';
import { T, drawStudio, drawPaint, drawBlocks, drawPainter, drawPower, drawPowerHud } from './draw.js';

export const meta = {
  width: 480,
  height: 270,
  pixelated: false,
  step: KL.DT,
  touchButtons: [{ label: 'DUW', bit: BTN.A }],
};

const SHADOW = '#3a2410';
const STRIPS = 8;
const STRIP_CELLS = KL_CELLS / STRIPS;
const PAINT_EVERY_MS = 50;
const KEYS = ['x', 'y', 'vx', 'vy', 'fx', 'fy', 'dash', 'cool', 'boost', 'stun', 'prevA'];

function decode(r, time) {
  const s = { time, phase: r.u8(), endsAt: 0, map: 'atelier', ents: [], powers: [], cells: null, owners: null, strip: 0, runs: null };
  s.endsAt = time + r.f32() * 1000;
  s.map = KL_MAP_IDS[r.u8()] ?? 'atelier';
  const n = r.u8();
  for (let i = 0; i < n; i++) {
    const slot = r.u8();
    const flags = r.u8();
    s.ents.push({
      slot, flags, ack: r.u16(),
      x: r.f32(), y: r.f32(), vx: r.f32(), vy: r.f32(), fx: r.f32(), fy: r.f32(),
      dash: r.f32(), cool: r.f32(), boost: r.f32(), stun: r.f32(), prevA: r.u8(),
      cells: r.u16(), wide: r.u8() / 10, splashes: r.u8(),
    });
  }
  const m = r.u8();
  for (let i = 0; i < m; i++) s.powers.push({ id: r.u8(), type: r.u8(), x: r.u16(), y: r.u16(), age: 0 });
  const k = r.u16();
  s.cells = new Uint16Array(k);
  s.owners = new Uint8Array(k);
  for (let i = 0; i < k; i++) {
    s.cells[i] = r.u16();
    s.owners[i] = r.u8();
  }
  s.strip = r.u8();
  const runs = r.u16();
  s.runs = new Uint8Array(runs * 2);
  for (let i = 0; i < runs * 2; i++) s.runs[i] = r.u8();
  return s;
}

// Darker version of a hex colour (for the paint edges and rollers).
function darker(hex) {
  const n = parseInt(hex.slice(1), 16);
  const d = (v) => Math.round(v * 0.72).toString(16).padStart(2, '0');
  return `#${d((n >> 16) & 255)}${d((n >> 8) & 255)}${d(n & 255)}`;
}

export function createGame() {
  let view, ctx, input, sfx, fx, bg, reduced;
  let walls = [];
  let mapId = '';
  let time = 0;
  let banner = null;
  let layer = null;
  let lctx = null;
  let dirty = true;
  let lastPaint = 0;
  const grid = new Uint8Array(KL_CELLS);
  const colors = new Array(8).fill(null);
  const darks = new Array(8).fill(null);
  const timers = [[KL_POWER.WIDE, 0], [KL_POWER.TURBO, 0]];
  const powerSeen = new Map(); // power id → first seen (for the blinking before it goes)
  const predictor = new Predictor({
    create: () => ({ x: 0, y: 0, vx: 0, vy: 0, fx: 1, fy: 0, dash: 0, cool: 0, boost: 0, stun: 0, prevA: 0 }),
    copy: (d, s) => { for (const k of KEYS) d[k] = s[k]; },
    step: (s, inp) => stepPainter(s, inp.ax, inp.ay, inp.buttons & BTN.A, KL.DT, walls),
  });
  const core = createArcadeCore({ decode, predictor, toServer: (m, o) => { for (const k of KEYS) o[k] = m[k]; } });
  const now = () => performance.now() / 1000;

  function applyGrid(s) {
    for (let i = 0; i < s.cells.length; i++) {
      if (grid[s.cells[i]] !== s.owners[i]) {
        grid[s.cells[i]] = s.owners[i];
        dirty = true;
      }
    }
    let at = s.strip * STRIP_CELLS;
    for (let i = 0; i < s.runs.length; i += 2) {
      const v = s.runs[i];
      const end = Math.min(KL_CELLS, at + s.runs[i + 1]);
      for (; at < end; at++) {
        if (grid[at] !== v) {
          grid[at] = v;
          dirty = true;
        }
      }
    }
  }

  function setMap(id) {
    if (id === mapId) return;
    mapId = id;
    walls = mapWalls(KL_MAPS[id] ?? KL_MAPS.atelier);
    grid.fill(0);
    dirty = true;
  }

  // The paint on its own layer at full resolution; redrawn at most 20 times a second.
  function blitPaint() {
    const cw = view.canvas.width;
    const ch = view.canvas.height;
    if (!layer || layer.width !== cw || layer.height !== ch) {
      layer = layer ?? document.createElement('canvas');
      layer.width = cw;
      layer.height = ch;
      lctx = layer.getContext('2d');
      dirty = true;
    }
    const t = performance.now();
    if (dirty && t - lastPaint >= PAINT_EVERY_MS) {
      lastPaint = t;
      dirty = false;
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, cw, ch);
      lctx.setTransform(cw / view.width, 0, 0, ch / view.height, 0, 0);
      drawPaint(lctx, grid, colors, darks);
    }
    ctx.drawImage(layer, 0, 0, view.width, view.height);
  }

  return {
    mount(v, net, c) {
      view = v;
      ctx = v.ctx;
      input = c.input;
      sfx = c.sfx;
      reduced = c.reducedMotion;
      core.mount(net, c);
      fx = createFx({ reducedMotion: reduced, smooth: true });
      bg = createSharpLayer(view, (l) => drawStudio(l, view.width, view.height));
      setMap(KL_MAPS[c.start?.settings?.map] ? c.start.settings.map : 'atelier');
    },

    onSnapshot(snap) {
      const s = core.onSnapshot(snap);
      setMap(s.map);
      applyGrid(s);
      for (const p of s.powers) {
        if (!powerSeen.has(p.id)) powerSeen.set(p.id, now());
      }
      if (powerSeen.size > 40) for (const id of powerSeen.keys()) if (!s.powers.some((p) => p.id === id)) powerSeen.delete(id);
    },

    onEvent(msg) {
      const me = core.mySlot();
      switch (msg.e) {
        case 'go': sfx.play('go'); break;
        case 'splash': {
          toScreenBurst(msg.x, msg.y, core.hex(msg.s), 26);
          sfx.play('splat');
          if (msg.v === me) banner = { text: 'GESPETTERD!', sub: `door ${core.name(msg.s)}`, color: core.hex(msg.s), until: now() + 1.3 };
          else if (msg.s === me) banner = { text: 'SPETTER!', sub: `${core.name(msg.v)} zit onder de verf`, color: '#ffe14d', until: now() + 1.2 };
          break;
        }
        case 'power': {
          const p = KL_POWERS[msg.type];
          if (msg.s === me) {
            banner = { text: p.name.toUpperCase() + '!', sub: p.tip, color: p.color, until: now() + 1.5 };
            sfx.play('item');
          } else sfx.play('coin');
          break;
        }
        case 'bomb':
          toScreenBurst(msg.x, msg.y, core.hex(msg.s), 40);
          fx.shake(4);
          sfx.play('splash');
          break;
        case 'end': sfx.play('win'); break;
        default: break;
      }
    },

    onReconnect() {
      core.reset();
      grid.fill(0);
      dirty = true;
    },

    update(dt) {
      time += dt;
      fx.update(dt);
      core.beep();
      const L = core.latest;
      const mine = core.mine();
      const inp = input.sample();
      if (!L || L.phase !== ARCADE_PHASE.PLAY || !mine || !predictor.ready) {
        core.idle();
        return;
      }
      const cool = predictor.state.cool;
      core.send(inp.ax, inp.ay, inp.buttons & BTN.A);
      if (predictor.state.cool > cool + 0.5) sfx.play('boost');
    },

    render(alpha) {
      const W = view.width;
      const H = view.height;
      bg.blit(ctx);
      const L = core.latest;
      if (!L) return;
      const me = core.mySlot();
      // Colours per owner (slot + 1).
      for (const e of L.ents) {
        const hex = core.hex(e.slot);
        if (colors[e.slot + 1] !== hex) {
          colors[e.slot + 1] = hex;
          darks[e.slot + 1] = darker(hex);
          dirty = true;
        }
      }
      ctx.save();
      ctx.translate(fx.shakeX(), fx.shakeY());
      blitPaint();
      drawBlocks(ctx, walls);
      const t = now();
      for (const p of L.powers) {
        p.age = t - (powerSeen.get(p.id) ?? t);
        drawPower(ctx, p, time);
      }
      const labels = [];
      core.each(core.sample(), 'ents', 'slot', (eb, x, y) => {
        const isMe = eb.slot === me && predictor.ready;
        const s = isMe ? predictor.state : eb;
        const wx = isMe ? predictor.get('x', alpha) : x;
        const wy = isMe ? predictor.get('y', alpha) : y;
        const sx = T.x + wx * T.k;
        const sy = T.y + wy * T.k;
        const hex = core.hex(eb.slot);
        drawPainter(ctx, sx, sy, s.fx, s.fy, hex, darks[eb.slot + 1] ?? hex, {
          wide: (eb.flags & KL_FLAG.WIDE) !== 0, dash: s.dash > 0, stun: s.stun > 0, time, me: eb.slot === me,
        });
        if ((s.dash > 0 || s.boost > 0) && !reduced && Math.random() < 0.5) fx.spawn(sx - s.fx * 5, sy - s.fy * 5, 0, 0, 0.4, hex, 1.6);
        labels.push([sx, sy, eb.slot]);
      });
      fx.drawParticles(ctx);
      for (const [sx, sy, slot] of labels) drawText(ctx, core.name(slot).slice(0, 10), sx, sy - 13, { color: '#ffffff', scale: 0.75, align: 'center', shadow: SHADOW });
      ctx.restore();

      // --- HUD: share bar, timer, scores ---
      const total = L.ents.reduce((n, e) => n + e.cells, 0);
      const barX = T.x;
      const barW = KL.COLS * KL.CELL * T.k;
      ctx.fillStyle = 'rgba(60, 35, 15, 0.45)';
      roundRect(ctx, barX, 4, barW, 7, 3.5);
      ctx.fill();
      const paintable = KL.COLS * KL.ROWS - walls.reduce((n, o) => n + (o.w / KL.CELL) * (o.h / KL.CELL), 0);
      let bx = barX;
      for (const e of [...L.ents].sort((a, b) => b.cells - a.cells)) {
        const w = (e.cells / paintable) * barW;
        ctx.fillStyle = core.hex(e.slot);
        ctx.fillRect(bx, 4, w, 7);
        bx += w;
      }
      const left = core.secondsLeft();
      const px = barX + barW + 12;
      if (L.phase === ARCADE_PHASE.PLAY) drawText(ctx, `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`, px, 6, { color: '#ffffff', scale: 1.5, shadow: SHADOW });
      [...L.ents].sort((a, b) => b.cells - a.cells).forEach((e, i) => {
        const y = 30 + i * 13;
        const pct = paintable ? Math.round((e.cells / paintable) * 100) : 0;
        ctx.fillStyle = core.hex(e.slot);
        roundRect(ctx, px, y + 1, 7, 7, 2);
        ctx.fill();
        drawText(ctx, core.name(e.slot).slice(0, 8), px + 10, y, { color: e.slot === me ? '#ffe14d' : '#ffffff', scale: 0.8, shadow: SHADOW });
        drawText(ctx, `${pct}%`, W - 5, y, { color: '#ffffff', scale: 0.8, align: 'right', shadow: SHADOW });
      });
      const mine = core.mine();
      if (mine && predictor.ready) {
        // Dash cooldown bar and running power-ups.
        const k = 1 - predictor.state.cool / KL.DASH_COOLDOWN_S;
        ctx.fillStyle = 'rgba(60, 35, 15, 0.55)';
        roundRect(ctx, px, H - 60, W - px - 6, 6, 3);
        ctx.fill();
        ctx.fillStyle = predictor.state.cool > 0 ? '#c9b59a' : '#ffe14d';
        roundRect(ctx, px, H - 60, (W - px - 6) * Math.max(0.08, k), 6, 3);
        ctx.fill();
        drawText(ctx, 'DUW', px, H - 72, { color: '#ffffff', scale: 0.75, shadow: SHADOW });
        timers[0][1] = mine.wide;
        timers[1][1] = predictor.state.boost;
        drawPowerHud(ctx, timers, px, H - 48, SHADOW);
      }
      if (total === 0 && L.phase === ARCADE_PHASE.PLAY && me >= 0) drawText(ctx, 'Rol over het doek om te verven!', T.x + barW / 2, H - 20, { color: '#ffffff', align: 'center', shadow: SHADOW });
      if (L.phase === ARCADE_PHASE.COUNTDOWN) {
        drawText(ctx, String(Math.max(1, Math.ceil(left))), T.x + barW / 2, H / 2 - 40, { color: '#ffffff', scale: 5, align: 'center', shadow: SHADOW });
        drawText(ctx, 'VERF ALLES IN JOUW KLEUR!', T.x + barW / 2, H / 2 + 4, { color: '#ffe14d', scale: 1.4, align: 'center', shadow: SHADOW });
      } else if (L.phase === ARCADE_PHASE.END) {
        const best = [...L.ents].sort((a, b) => b.cells - a.cells)[0];
        drawText(ctx, 'EINDE!', T.x + barW / 2, H / 2 - 40, { color: '#ffe14d', scale: 3, align: 'center', shadow: SHADOW });
        if (best) drawText(ctx, `${core.name(best.slot)} is de Kladderkoning`, T.x + barW / 2, H / 2 - 4, { color: core.hex(best.slot), scale: 1.2, align: 'center', shadow: SHADOW });
      } else if (banner && t < banner.until) {
        drawText(ctx, banner.text, T.x + barW / 2, H / 2 - 40, { color: banner.color, scale: 2.4, align: 'center', shadow: SHADOW });
        drawText(ctx, banner.sub, T.x + barW / 2, H / 2 - 14, { color: '#ffffff', align: 'center', shadow: SHADOW });
      } else if (me < 0) drawText(ctx, 'JE KIJKT MEE', T.x + barW / 2, H - 20, { color: '#ffffff', align: 'center', shadow: SHADOW });
      fx.drawTexts(ctx);
    },

    unmount() {
      core.reset();
      fx?.clear();
    },
  };

  function toScreenBurst(x, y, color, n) {
    fx.burst(T.x + x * T.k, T.y + y * T.k, color, reduced ? 6 : n, { speed: 70, life: 0.6, size: 2.2, drag: 0.88 });
  }
}

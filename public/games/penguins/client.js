// Pinguïnbotsen (client side): your penguin is predicted with the shared
// movement, the others are interpolated; bumps and falls come from the
// server. HUD: rounds won (fish), who pushed whom into the water, banners,
// running power-ups.
import { BTN } from '../../../shared/messages.js';
import { PG, PG_FLAG, PG_POWER, PG_POWERS, stepPenguin } from '../../../shared/games/penguins.js';
import { createArcadeCore, ARCADE_PHASE } from '../common/arcade.js';
import { Predictor } from '../../js/core/predict.js';
import { rgb } from '../../js/gl/mesh.js';
import { drawText, roundRect } from '../../js/core/hudtext.js';
import { createPenguinScene } from './scene.js';
import { drawPowerHud } from './powers.js';

export const meta = {
  width: 480,
  height: 270,
  pixelated: false,
  gl: true,
  step: PG.DT,
  touchButtons: [{ label: 'DUW', bit: BTN.A }],
};

const SHADOW = '#10263a';
const FEED_S = 4;

function decode(r, time) {
  const s = { time, phase: r.u8(), endsAt: 0, round: 0, radius: 0, ents: [], powers: [] };
  s.endsAt = time + r.f32() * 1000;
  s.round = r.u8();
  s.radius = r.f32();
  const n = r.u8();
  for (let i = 0; i < n; i++) {
    const slot = r.u8();
    const flags = r.u8();
    s.ents.push({
      slot, flags, ack: r.u16(),
      x: r.f32(), y: r.f32(), vx: r.f32(), vy: r.f32(), fx: r.f32(), fy: r.f32(), dash: r.f32(), cool: r.f32(),
      stun: r.f32(), boost: r.f32(), grip: r.f32(), prevA: r.u8(),
      wins: r.u8(), pushes: r.u8(), sink: r.u8() / 10, heavy: r.u8() / 10, punch: r.u8() / 10,
      alive: (flags & PG_FLAG.ALIVE) !== 0,
    });
  }
  const m = r.u8();
  for (let i = 0; i < m; i++) s.powers.push({ id: r.u8(), type: r.u8(), x: r.i16() / 10, y: r.i16() / 10, age: r.u8() / 4 });
  return s;
}

const KEYS = ['x', 'y', 'vx', 'vy', 'fx', 'fy', 'dash', 'cool', 'stun', 'boost', 'grip', 'prevA'];
const HEAVY_SIZE = 1.3;

export function createGame() {
  let view, ctx, input, sfx, scene, reduced;
  let banner = null;
  let lastRound = 0;
  const feed = [];
  const scratch = { x: 0, y: 0, depth: 0 };
  const fx = { punch: false, stun: false, size: 1 };
  const timers = [[PG_POWER.TURBO, 0], [PG_POWER.GRIP, 0], [PG_POWER.HEAVY, 0], [PG_POWER.PUNCH, 0]];
  const predictor = new Predictor({
    create: () => ({ x: 0, y: 0, vx: 0, vy: 0, fx: 1, fy: 0, dash: 0, cool: 0, stun: 0, boost: 0, grip: 0, prevA: 0 }),
    copy: (d, s) => { for (const k of KEYS) d[k] = s[k]; },
    step: (s, inp) => stepPenguin(s, inp.ax, inp.ay, inp.buttons & BTN.A, PG.DT),
  });
  const core = createArcadeCore({
    decode,
    predictor,
    toServer: (m, o) => { for (const k of KEYS) o[k] = m[k]; },
  });
  const now = () => performance.now() / 1000;

  function fallback2D(L, me) {
    ctx.fillStyle = '#2c6a8a';
    ctx.fillRect(0, 0, view.width, view.height);
    const s = 0.9;
    const cx = view.width / 2;
    const cy = view.height / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, L.radius * s, 0, Math.PI * 2);
    ctx.fillStyle = '#f2f8fc';
    ctx.fill();
    for (const p of L.powers) {
      ctx.beginPath();
      ctx.arc(cx + p.x * s, cy + p.y * s, 4, 0, Math.PI * 2);
      ctx.fillStyle = PG_POWERS[p.type].color;
      ctx.fill();
    }
    for (const e of L.ents) {
      if (!e.alive) continue;
      const mine = e.slot === me && predictor.ready;
      const x = mine ? predictor.state.x : e.x;
      const y = mine ? predictor.state.y : e.y;
      ctx.beginPath();
      ctx.arc(cx + x * s, cy + y * s, PG.RADIUS * s, 0, Math.PI * 2);
      ctx.fillStyle = core.hex(e.slot);
      ctx.fill();
    }
  }

  return {
    mount(v, net, c) {
      view = v;
      ctx = v.ctx;
      input = c.input;
      sfx = c.sfx;
      reduced = c.reducedMotion;
      core.mount(net, c);
      scene = view.glCanvas ? createPenguinScene(view.glCanvas, { reducedMotion: reduced }) : null;
      if (!scene) view.glCanvas?.remove();
    },

    onSnapshot(snap) {
      core.onSnapshot(snap);
      const L = core.latest;
      if (L.round !== lastRound) {
        lastRound = L.round;
        core.reset();
        banner = null;
      }
    },

    onEvent(msg) {
      const me = core.mySlot();
      switch (msg.e) {
        case 'go': sfx.play('go'); break;
        case 'bump':
          scene?.bump(msg.x, msg.y, msg.p);
          sfx.play(msg.p > 110 ? 'thud' : 'hit');
          break;
        case 'splash':
          scene?.splash(msg.x, msg.y);
          sfx.play('splash');
          feed.unshift({ who: core.name(msg.s), color: core.hex(msg.s), by: msg.by >= 0 ? core.name(msg.by) : null, byColor: msg.by >= 0 ? core.hex(msg.by) : null, at: now() });
          feed.length = Math.min(feed.length, 4);
          if (msg.s === me) banner = { text: 'PLONS!', sub: msg.by >= 0 ? `${core.name(msg.by)} duwde je erin` : 'je gleed van de schots', color: '#7fd3ff', until: now() + 2 };
          else if (msg.by === me) {
            banner = { text: 'RAAK!', sub: `${core.name(msg.s)} ligt in het water`, color: '#ffe14d', until: now() + 1.4 };
            sfx.play('coin');
          }
          break;
        case 'roundEnd': {
          const name = msg.s >= 0 ? core.name(msg.s) : 'Niemand';
          banner = { text: msg.s === me ? 'JIJ WINT DE RONDE!' : `${name.toUpperCase()} WINT`, sub: '', color: msg.s >= 0 ? core.hex(msg.s) : '#ffffff', until: now() + 3 };
          sfx.play(msg.s === me ? 'win' : 'countdown');
          break;
        }
        case 'power': {
          const p = PG_POWERS[msg.type];
          scene?.pickup(msg.x, msg.y, p.color);
          if (msg.s === me) {
            banner = { text: p.name.toUpperCase() + '!', sub: p.tip, color: p.color, until: now() + 1.5 };
            sfx.play('item');
          } else sfx.play('coin');
          break;
        }
        case 'punch':
          scene?.bump(msg.x, msg.y, 200);
          sfx.play('explode');
          if (msg.s === me) banner = { text: 'KNAL!', sub: `${core.name(msg.v)} vliegt weg`, color: '#ff5a5a', until: now() + 1.2 };
          break;
        case 'shock':
          scene?.shockwave(msg.x, msg.y);
          sfx.play('zap');
          break;
        case 'end': sfx.play('win'); break;
        default: break;
      }
    },

    onReconnect() {
      core.reset();
    },

    update(dt) {
      scene?.update(dt);
      core.beep();
      const L = core.latest;
      const mine = core.mine();
      const inp = input.sample();
      if (L && L.phase === ARCADE_PHASE.PLAY && mine?.alive && predictor.ready) {
        const cool = predictor.state.cool;
        core.send(inp.ax, inp.ay, inp.buttons & BTN.A);
        if (predictor.state.cool > cool + 0.5) sfx.play('boost'); // a dash just started
      } else core.idle();
    },

    render(alpha) {
      const L = core.latest;
      ctx.clearRect(0, 0, view.width, view.height);
      if (!L) {
        scene?.begin(PG.FLOE_START);
        return;
      }
      const me = core.mySlot();
      if (scene) {
        if (!scene.begin(L.radius)) return;
      } else fallback2D(L, me);
      const sample = core.sample();
      const labels = [];
      if (scene) {
        for (const p of L.powers) scene.item(p.x, p.y, p.type, p.age, p.id);
        core.each(sample, 'ents', 'slot', (eb, x, y) => {
          const mine = eb.slot === me && predictor.ready && eb.alive;
          const px = mine ? predictor.get('x', alpha) : x;
          const py = mine ? predictor.get('y', alpha) : y;
          const st = mine ? predictor.state : eb;
          const speed = Math.hypot(st.vx, st.vy);
          const dashing = st.dash > 0;
          const size = eb.heavy > 0 ? HEAVY_SIZE : 1;
          if (eb.alive) {
            scene.penguin(px, py, st.fx, st.fy, speed, dashing, rgb(core.hex(eb.slot)), 0, size);
            fx.punch = eb.punch > 0;
            fx.stun = st.stun > 0;
            fx.size = size;
            scene.effects(px, py, st.fx, st.fy, fx);
            if (dashing || speed > 70 || st.boost > 0) scene.trail(px, py);
            labels.push([px, py, eb.slot, size]);
          } else if (eb.sink > 0) {
            scene.penguin(px, py, st.fx, st.fy, 0, false, rgb(core.hex(eb.slot)), 1 - eb.sink / 1.4);
          }
        });
        scene.end();
      }

      // --- HUD ---
      for (const [x, y, slot, size] of labels) {
        const p = scene.project(x, y, 22 * size, scratch);
        if (p) drawText(ctx, core.name(slot), p.x, p.y - 8, { color: core.hex(slot), align: 'center', shadow: SHADOW });
      }
      // Rounds won: a fish per round.
      const rows = [...L.ents].sort((a, b) => b.wins - a.wins);
      rows.forEach((e, i) => {
        const y = 5 + i * 10;
        ctx.fillStyle = 'rgba(16, 38, 58, 0.5)';
        roundRect(ctx, 4, y - 1, 60 + Math.max(1, e.wins) * 8, 9, 4.5);
        ctx.fill();
        ctx.fillStyle = core.hex(e.slot);
        ctx.fillRect(7, y + 1.5, 4, 4);
        drawText(ctx, core.name(e.slot).slice(0, 9), 14, y + 0.4, { color: e.alive ? '#ffffff' : '#9fb4c4', scale: 0.78 });
        for (let k = 0; k < e.wins; k++) {
          const fx = 62 + k * 8;
          ctx.fillStyle = '#ffb347';
          ctx.beginPath();
          ctx.ellipse(fx, y + 3.5, 2.6, 1.7, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(fx + 2.2, y + 3.5);
          ctx.lineTo(fx + 4.4, y + 1.8);
          ctx.lineTo(fx + 4.4, y + 5.2);
          ctx.fill();
        }
      });
      drawText(ctx, `RONDE ${L.round}`, view.width - 6, 6, { color: '#ffffff', scale: 1.4, align: 'right', shadow: SHADOW });
      const t = now();
      feed.filter((f) => t - f.at < FEED_S).forEach((f, i) => {
        const text = f.by ? `${f.by} duwt ${f.who} erin` : `${f.who} glijdt het water in`;
        drawText(ctx, text, view.width - 6, 22 + i * 11, { color: '#e8f4ff', align: 'right', shadow: SHADOW });
      });
      const mine = core.mine();
      const left = core.secondsLeft();
      if (L.phase === ARCADE_PHASE.COUNTDOWN) {
        drawText(ctx, String(Math.max(1, Math.ceil(left))), view.width / 2, view.height / 2 - 40, { color: '#ffffff', scale: 5, align: 'center', shadow: SHADOW });
        drawText(ctx, 'DUW ZE VAN DE SCHOTS!', view.width / 2, view.height / 2 + 4, { color: '#ffe14d', scale: 1.4, align: 'center', shadow: SHADOW });
      } else if (L.phase === ARCADE_PHASE.END) {
        drawText(ctx, 'EINDE!', view.width / 2, view.height / 2 - 30, { color: '#ffe14d', scale: 3, align: 'center', shadow: SHADOW });
      } else if (banner && t < banner.until) {
        drawText(ctx, banner.text, view.width / 2, view.height / 2 - 40, { color: banner.color, scale: 2.6, align: 'center', shadow: SHADOW });
        if (banner.sub) drawText(ctx, banner.sub, view.width / 2, view.height / 2 - 12, { color: '#ffffff', align: 'center', shadow: SHADOW });
      } else if (mine && !mine.alive && L.phase === ARCADE_PHASE.PLAY) {
        drawText(ctx, 'Je ligt in het water: kijk wie er wint', view.width / 2, view.height - 18, { color: '#e8f4ff', align: 'center', shadow: SHADOW });
      } else if (me < 0) {
        drawText(ctx, 'JE KIJKT MEE', view.width / 2, view.height - 18, { color: '#e8f4ff', align: 'center', shadow: SHADOW });
      }
      // Dash ready indicator.
      if (mine?.alive && predictor.ready) {
        const cool = predictor.state.cool;
        const k = 1 - cool / PG.DASH_COOLDOWN_S;
        ctx.fillStyle = 'rgba(16, 38, 58, 0.55)';
        roundRect(ctx, view.width / 2 - 30, view.height - 12, 60, 7, 3.5);
        ctx.fill();
        ctx.fillStyle = cool > 0 ? '#9fb4c4' : '#ffe14d';
        roundRect(ctx, view.width / 2 - 30, view.height - 12, 60 * Math.max(0.08, k), 7, 3.5);
        ctx.fill();
        timers[0][1] = predictor.state.boost;
        timers[1][1] = predictor.state.grip;
        timers[2][1] = mine.heavy;
        timers[3][1] = mine.punch;
        drawPowerHud(ctx, timers, 6, view.height - 22, SHADOW);
      }
    },

    unmount() {
      scene?.destroy();
      core.reset();
    },
  };
}

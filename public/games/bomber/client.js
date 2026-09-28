// Boemstad (client side): your walker is predicted with the shared movement
// code (walls, houses and bombs from the latest snapshot); everything else
// is interpolated. 3D view, 2D HUD; a flat fallback without WebGL.
import { BTN } from '../../../shared/messages.js';
import { BOMB_COLS, BOMB_ROWS, BTILE, BT, ITEM_COLORS, stepWalker } from '../../../shared/games/bomber.js';
import { createArcadeCore, ARCADE_PHASE, lerp } from '../common/arcade.js';
import { Predictor } from '../../js/core/predict.js';
import { drawText, roundRect } from '../../js/core/hudtext.js';
import { rgb } from '../../js/gl/mesh.js';
import { createBomberScene } from './scene.js';

export const meta = {
  width: 480, height: 270, pixelated: false, gl: true, step: 1 / 30,
  touchButtons: [{ label: 'BOM', bit: BTN.A }],
};

const SHADOW = '#0b0b1e';
const N = BOMB_COLS * BOMB_ROWS;

function decode(r, time) {
  const s = { time, phase: r.u8(), endsAt: 0, ents: [], bombs: [], flames: [], items: [] };
  s.endsAt = time + r.f32() * 1000;
  s.round = r.u8();
  s.winsNeeded = r.u8();
  s.sudden = r.u8() === 1;
  const n = r.u8();
  for (let i = 0; i < n; i++) {
    s.ents.push({
      slot: r.u8(), flags: r.u8(), ack: r.u16(), x: r.f32(), y: r.f32(), dir: r.u8(), alive: r.u8() === 1,
      bombsMax: r.u8(), range: r.u8(), speed: r.u8(), wins: r.u8(),
    });
  }
  s.tiles = new Uint8Array(N);
  for (let i = 0; i < N; i += 4) {
    const v = r.u8();
    for (let k = 0; k < 4 && i + k < N; k++) s.tiles[i + k] = (v >> (k * 2)) & 3;
  }
  const nb = r.u8();
  for (let i = 0; i < nb; i++) s.bombs.push({ x: r.u8(), y: r.u8(), fuse: r.u8() / 10 });
  const nf = r.u8();
  for (let i = 0; i < nf; i++) s.flames.push({ x: r.u8(), y: r.u8() });
  const ni = r.u8();
  for (let i = 0; i < ni; i++) s.items.push({ x: r.u8(), y: r.u8(), type: r.u8() });
  return s;
}

export function createGame() {
  let tiles = new Uint8Array(N);
  const bombAt = new Uint8Array(N);
  const predictor = new Predictor({
    create: () => ({ x: 24, y: 24, dir: 1, speed: 0 }),
    copy: (d, s) => { d.x = s.x; d.y = s.y; d.dir = s.dir; d.speed = s.speed; },
    step: (s, inp) => stepWalker(s, inp.ax, inp.ay, 1 / 30, tiles, bombAt),
  });
  const core = createArcadeCore({
    decode, predictor,
    toServer: (e, out) => { out.x = e.x; out.y = e.y; out.dir = e.dir; out.speed = e.speed; },
  });
  let view, ctx, input, sfx, scene;
  let banner = null;
  const scratch = { x: 0, y: 0, depth: 0 };

  return {
    mount(v, net, c) {
      view = v;
      ctx = v.ctx;
      input = c.input;
      sfx = c.sfx;
      core.mount(net, c);
      scene = v.glCanvas ? createBomberScene(v.glCanvas, { reducedMotion: c.reducedMotion }) : null;
      if (!scene) v.glCanvas?.remove();
    },

    onSnapshot(snap) {
      const prev = core.latest;
      // Tiles + bombs first: prediction replays against them.
      const s = core.onSnapshot(snap);
      tiles = s.tiles;
      bombAt.fill(0);
      for (const b of s.bombs) bombAt[b.y * BOMB_COLS + b.x] = 1;
      if (prev && s.round !== prev.round) {
        core.reset();
        banner = null;
      }
      scene?.setTiles(s.tiles);
    },

    onEvent(msg) {
      const slot = core.mySlot();
      switch (msg.e) {
        case 'go': sfx.play('go'); break;
        case 'bomb': if (msg.s === slot) sfx.play('click'); break;
        case 'boom': sfx.play('explode'); scene?.blast(msg.x, msg.y); break;
        case 'item': if (msg.s === slot) sfx.play('coin'); break;
        case 'die': sfx.play(msg.s === slot ? 'lose' : 'hit'); break;
        case 'sudden': sfx.play('error'); break;
        case 'wallDrop': sfx.play('thud'); scene?.shake(2); break;
        case 'roundEnd':
          banner = msg.s >= 0 ? { text: msg.s === slot ? 'JIJ WINT DE RONDE!' : `${core.name(msg.s).toUpperCase()} WINT`, color: core.hex(msg.s) } : { text: 'GELIJKSPEL', color: '#ffffff' };
          sfx.play(msg.s === slot ? 'win' : 'countdown');
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
      const inp = input.sample();
      const me = core.mine();
      if (core.latest?.phase === ARCADE_PHASE.PLAY && me?.alive && predictor.ready) core.send(inp.ax, inp.ay, inp.buttons);
      else core.idle();
    },

    render(alpha) {
      ctx.clearRect(0, 0, view.width, view.height);
      const s = core.latest;
      const sample = core.sample();
      if (!s) return;
      if (scene) {
        if (!scene.begin()) return;
        for (const b of s.bombs) scene.bomb(b.x, b.y, b.fuse);
        for (const f of s.flames) scene.flame(f.x, f.y);
        for (const it of s.items) scene.item(it.x, it.y, it.type);
      } else this.flat(s);
      const people = [];
      if (sample) {
        const a = sample.a.state;
        for (const eb of sample.b.state.ents) {
          if (!eb.alive) continue;
          const ea = core.find(a.ents, eb.slot) ?? eb;
          const me = eb.slot === core.mySlot() && predictor.ready;
          const x = me ? predictor.get('x', alpha) : lerp(ea.x, eb.x, sample.t);
          const y = me ? predictor.get('y', alpha) : lerp(ea.y, eb.y, sample.t);
          const dir = me ? predictor.state.dir : eb.dir;
          const walking = me ? Math.hypot(input.state.ax, input.state.ay) > 0.4 : Math.hypot(eb.x - ea.x, eb.y - ea.y) > 0.3;
          people.push([x, y, eb.slot]);
          if (scene) scene.person(x, y, dir, rgb(core.hex(eb.slot)), walking);
          else {
            ctx.fillStyle = core.hex(eb.slot);
            ctx.fillRect(Math.round(this.fx(x)) - 5, Math.round(this.fy(y)) - 5, 10, 10);
          }
        }
      }
      if (scene) {
        for (const [x, y] of people) scene.shadow(x, y);
        scene.endParticles();
        for (const [x, y, slot] of people) {
          const p = scene.project(x, y, 22, scratch);
          if (p) drawText(ctx, slot === core.mySlot() ? 'JIJ' : core.name(slot).slice(0, 8), p.x, p.y - 8, { color: slot === core.mySlot() ? '#ffffff' : core.hex(slot), align: 'center', shadow: SHADOW });
        }
      }
      this.hud(s);
    },

    // Flat top-down view without WebGL.
    fx: (x) => 60 + x * 1.2,
    fy: (y) => 8 + y * 1.2,
    flat(s) {
      ctx.fillStyle = '#5f9a45';
      ctx.fillRect(0, 0, view.width, view.height);
      const t = BTILE * 1.2;
      for (let i = 0; i < N; i++) {
        const x = i % BOMB_COLS;
        const y = Math.floor(i / BOMB_COLS);
        ctx.fillStyle = s.tiles[i] === BT.WALL ? '#8a8a92' : s.tiles[i] === BT.BLOCK ? '#b5553c' : (x + y) % 2 ? '#78b556' : '#70ad4f';
        ctx.fillRect(60 + x * t, 8 + y * t, Math.ceil(t), Math.ceil(t));
      }
      for (const f of s.flames) { ctx.fillStyle = '#ff8a2a'; ctx.fillRect(60 + f.x * t + 2, 8 + f.y * t + 2, t - 4, t - 4); }
      for (const b of s.bombs) { ctx.fillStyle = '#10101a'; ctx.fillRect(60 + b.x * t + 4, 8 + b.y * t + 4, t - 8, t - 8); }
      for (const it of s.items) { ctx.fillStyle = ITEM_COLORS[it.type]; ctx.fillRect(60 + it.x * t + 6, 8 + it.y * t + 6, t - 12, t - 12); }
    },

    hud(s) {
      drawText(ctx, `RONDE ${s.round}`, 6, 5, { color: '#ffffff', shadow: SHADOW });
      drawText(ctx, `WINNEN BIJ ${s.winsNeeded}`, 6, 15, { color: '#a3a8d6', shadow: SHADOW });
      let y = 5;
      for (const e of [...s.ents].sort((p, q) => q.wins - p.wins)) {
        ctx.fillStyle = 'rgba(20,20,26,0.5)';
        roundRect(ctx, view.width - 96, y - 2, 94, 11, 3);
        ctx.fill();
        ctx.fillStyle = core.hex(e.slot);
        ctx.globalAlpha = e.alive ? 1 : 0.4;
        roundRect(ctx, view.width - 92, y, 6, 7, 1.5);
        ctx.fill();
        ctx.globalAlpha = 1;
        drawText(ctx, core.name(e.slot).slice(0, 9), view.width - 84, y, { color: e.alive ? '#ffffff' : '#8a8fb8', shadow: SHADOW });
        drawText(ctx, String(e.wins), view.width - 6, y, { color: '#ffe14d', align: 'right', shadow: SHADOW });
        y += 11;
      }
      const me = core.mine();
      if (me) {
        const stats = [['BOMMEN', me.bombsMax, ITEM_COLORS[0]], ['BEREIK', me.range, ITEM_COLORS[1]], ['SNELHEID', me.speed + 1, ITEM_COLORS[2]]];
        stats.forEach(([label, v, color], i) => drawText(ctx, `${label} ${v}`, 6 + i * 70, view.height - 12, { color, shadow: SHADOW }));
      }
      if (s.sudden && s.phase === ARCADE_PHASE.PLAY) drawText(ctx, 'DE STAD KRIMPT!', view.width / 2, 6, { color: '#ff4d6d', align: 'center', shadow: SHADOW });
      if (s.phase === ARCADE_PHASE.COUNTDOWN) {
        drawText(ctx, String(Math.max(1, Math.ceil(core.secondsLeft()))), view.width / 2, 100, { color: '#ffe14d', scale: 6, align: 'center', shadow: '#ff3ea5' });
        drawText(ctx, 'SPATIE = BOM LEGGEN', view.width / 2, 150, { color: '#ffffff', align: 'center', shadow: SHADOW });
      } else if (banner && s.phase !== ARCADE_PHASE.PLAY) {
        drawText(ctx, banner.text, view.width / 2, 110, { color: banner.color, scale: 3, align: 'center', shadow: SHADOW });
      } else if (me && !me.alive) {
        drawText(ctx, 'OPGEBLAZEN! KIJK MEE', view.width / 2, 120, { color: '#ff4d6d', scale: 2, align: 'center', shadow: SHADOW });
      }
    },

    unmount() {
      scene?.destroy();
    },
  };
}

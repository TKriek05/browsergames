// Ruimtegolf (client side): your ship is predicted; the formation steps in
// the classic stutter rhythm (not smoothed), shots and bombs are interpolated.
import { BTN } from '../../../shared/messages.js';
import { INV, alienType, bunkerX, stepShip } from '../../../shared/games/invaders.js';
import { createArcadeCore, ARCADE_PHASE, lerp } from '../common/arcade.js';
import { Predictor } from '../../js/core/predict.js';
import { drawText } from '../../js/core/pixelfont.js';
import { createFx } from '../../js/core/fx.js';
import { createLayer } from '../../js/core/canvas.js';

export const meta = { width: 320, height: 180, pixelated: true, step: 1 / 30, touchButtons: [{ label: 'VUUR', bit: BTN.A }] };

const SHADOW = '#0b0b1e';
const ALIEN_COLORS = ['#ff3ea5', '#3ef0ff', '#5dff8a'];
const ALIENS = [
  [['....###....', '...#####...', '..#######..', '.##.###.##.', '.#########.', '...#...#...', '..#.###.#..', '.#.......#.'],
    ['....###....', '...#####...', '..#######..', '.##.###.##.', '.#########.', '..#.#.#.#..', '.#.......#.', '..#.....#..']],
  [['..#.....#..', '...#...#...', '..#######..', '.##.###.##.', '###########', '#.#######.#', '#.#.....#.#', '...##.##...'],
    ['..#.....#..', '#..#...#..#', '#.#######.#', '###.###.###', '###########', '.#########.', '..#.....#..', '.#.......#.']],
  [['...#####...', '.#########.', '###########', '###..#..###', '###########', '..##...##..', '.##.###.##.', '##.......##'],
    ['...#####...', '.#########.', '###########', '###..#..###', '###########', '...##.##...', '..##.#.##..', '...#...#...']],
];
const SHIP = ['.....#.....', '....###....', '....###....', '.#########.', '###########', '###########', '###.....###'];
const UFO = ['.....######.....', '...##########...', '..############..', '.##.##.##.##.##.', '################', '..###..##..###..', '...#........#...'];

function sprite(rows, color) {
  const { canvas, ctx } = createLayer(rows[0].length, rows.length);
  ctx.fillStyle = color;
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && ctx.fillRect(x, y, 1, 1)));
  return canvas;
}

function decode(r, time) {
  const s = { time, phase: r.u8(), endsAt: 0 };
  s.endsAt = time + r.f32() * 1000;
  s.wave = r.u8();
  s.wavesMax = r.u8();
  s.lives = r.u8();
  s.fx = r.f32();
  s.fy = r.f32();
  s.frame = r.u8();
  s.aliens = new Uint8Array(INV.cols * INV.rows);
  for (let b = 0; b < 7; b++) {
    const v = r.u8();
    for (let k = 0; k < 8; k++) if (b * 8 + k < s.aliens.length) s.aliens[b * 8 + k] = (v >> k) & 1;
  }
  s.ents = [];
  const n = r.u8();
  for (let i = 0; i < n; i++) {
    const e = { slot: r.u8(), flags: r.u8(), ack: r.u16(), p: r.f32() };
    const st = r.u8();
    e.alive = (st & 1) !== 0;
    e.inv = (st & 2) !== 0;
    e.score = r.u16();
    s.ents.push(e);
  }
  s.shots = [];
  const ns = r.u8();
  for (let i = 0; i < ns; i++) s.shots.push({ x: r.i16() / 4, y: r.i16() / 4, slot: r.u8() });
  s.bombs = [];
  const nb = r.u8();
  for (let i = 0; i < nb; i++) s.bombs.push({ x: r.i16() / 4, y: r.i16() / 4 });
  s.bunkers = [];
  for (let k = 0; k < INV.bunkers; k++) {
    const cells = new Uint8Array(INV.bunkerCols * INV.bunkerRows);
    for (let b = 0; b < 12; b++) {
      const v = r.u8();
      for (let j = 0; j < 8; j++) cells[b * 8 + j] = (v >> j) & 1;
    }
    s.bunkers.push(cells);
  }
  const ux = r.i16();
  s.ufo = ux === -32768 ? null : ux / 4;
  return s;
}

export function createGame() {
  const predictor = new Predictor({
    create: () => ({ p: 160 }),
    copy: (d, s) => { d.p = s.p; },
    step: (s, inp) => stepShip(s, inp.ax, 1 / 30),
    smoothKeys: ['p'],
  });
  const core = createArcadeCore({ decode, predictor, toServer: (e, out) => { out.p = e.p; } });
  let ctx, input, sfx, fx, bg;
  let lastFrame = -1;
  let banner = null;
  const alienSprites = ALIENS.map((frames, t) => frames.map((rows) => sprite(rows, ALIEN_COLORS[t])));
  const ufoSprite = sprite(UFO, '#ff4d6d');
  const ships = new Map();
  const shipSprite = (hex) => {
    if (!ships.has(hex)) ships.set(hex, sprite(SHIP, hex));
    return ships.get(hex);
  };

  return {
    mount(view, net, c) {
      ctx = view.ctx;
      input = c.input;
      sfx = c.sfx;
      core.mount(net, c);
      fx = createFx({ reducedMotion: c.reducedMotion });
      bg = drawStars();
    },

    onSnapshot(snap) {
      const s = core.onSnapshot(snap);
      if (s.frame !== lastFrame && s.phase === ARCADE_PHASE.PLAY) sfx.play('beat');
      lastFrame = s.frame;
    },

    onEvent(msg) {
      const slot = core.mySlot();
      switch (msg.e) {
        case 'go': sfx.play('go'); banner = null; break;
        case 'wave': banner = null; break;
        case 'shoot': if (msg.s === slot) sfx.play('shoot'); break;
        case 'kill':
          sfx.play(msg.s === slot ? 'hit' : 'click');
          fx.burst(msg.x, msg.y, ALIEN_COLORS[alienType(msg.row)], 14, { speed: 50, life: 0.5 });
          break;
        case 'ufo': sfx.play('item'); break;
        case 'ufoHit':
          sfx.play('coin');
          fx.burst(msg.x, 17, '#ff4d6d', 24, { speed: 60, life: 0.7 });
          fx.text(String(msg.p), msg.x, 24, core.hex(msg.s), 1, 1.2);
          break;
        case 'shipHit':
          sfx.play('explode');
          fx.burst(msg.x, INV.shipY, core.hex(msg.s), 30, { speed: 70, life: 0.8 });
          fx.shake(msg.s === slot ? 6 : 3);
          break;
        case 'roundEnd': banner = { text: `GOLF ${msg.wave} VERSLAGEN!`, color: '#5dff8a' }; sfx.play('win'); break;
        case 'end': banner = msg.win ? { text: 'AARDE GERED!', color: '#5dff8a' } : { text: 'GAME OVER', color: '#ff4d6d' }; sfx.play(msg.win ? 'win' : 'lose'); break;
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
      if (core.latest?.phase === ARCADE_PHASE.PLAY && me?.alive && predictor.ready) core.send(inp.ax, 0, inp.buttons);
      else core.idle();
    },

    render(alpha) {
      ctx.save();
      ctx.translate(fx.shakeX(), fx.shakeY());
      ctx.drawImage(bg, 0, 0);
      const s = core.latest;
      const sample = core.sample();
      if (s) {
        const b = sample ? sample.b.state : s;
        for (let i = 0; i < b.aliens.length; i++) {
          if (!b.aliens[i]) continue;
          const row = Math.floor(i / INV.cols);
          const x = Math.round(b.fx + (i % INV.cols) * INV.dx);
          const y = Math.round(b.fy + row * INV.dy);
          ctx.drawImage(alienSprites[alienType(row)][b.frame], x, y);
        }
        b.bunkers.forEach((cells, k) => {
          const bx = bunkerX(k);
          ctx.fillStyle = '#5dff8a';
          for (let r = 0; r < INV.bunkerRows; r++) {
            for (let c = 0; c < INV.bunkerCols; c++) if (cells[r * INV.bunkerCols + c]) ctx.fillRect(bx + c * 2, INV.bunkerY + r * 2, 2, 2);
          }
        });
        if (b.ufo !== null) ctx.drawImage(ufoSprite, Math.round(b.ufo) - 8, 14);
      }
      if (s && sample) {
        const a = sample.a.state;
        for (const eb of sample.b.state.ents) {
          if (!eb.alive) continue;
          const ea = core.find(a.ents, eb.slot) ?? eb;
          const me = eb.slot === core.mySlot() && predictor.ready;
          const p = me ? predictor.get('p', alpha) : lerp(ea.p, eb.p, sample.t);
          if (eb.inv && Math.floor(performance.now() / 100) % 2) continue;
          ctx.drawImage(shipSprite(core.hex(eb.slot)), Math.round(p) - 5, INV.shipY - 3);
          if (me) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(Math.round(p), INV.shipY + 6, 1, 1);
          }
        }
        for (const shot of sample.b.state.shots) {
          ctx.fillStyle = core.hex(shot.slot);
          ctx.fillRect(Math.round(shot.x), Math.round(shot.y) - 2, 1, 4);
        }
        const zig = Math.floor(performance.now() / 80) % 2;
        for (const bomb of sample.b.state.bombs) {
          ctx.fillStyle = '#ffe14d';
          const x = Math.round(bomb.x);
          const y = Math.round(bomb.y);
          ctx.fillRect(x + (zig ? -1 : 1), y - 3, 1, 2);
          ctx.fillRect(x, y - 1, 1, 2);
          ctx.fillRect(x + (zig ? 1 : -1), y + 1, 1, 2);
        }
      }
      ctx.fillStyle = '#5dff8a';
      ctx.fillRect(0, INV.shipY + 8, INV.width, 1);
      fx.drawParticles(ctx);
      if (s) this.hud(s);
      fx.drawTexts(ctx);
      ctx.restore();
    },

    hud(s) {
      drawText(ctx, s.wavesMax ? `GOLF ${s.wave}/${s.wavesMax}` : `GOLF ${s.wave}`, 4, 2, { color: '#ffffff', shadow: SHADOW });
      const ship = shipSprite('#ff4d6d');
      for (let i = 0; i < Math.min(s.lives, 8); i++) ctx.drawImage(ship, 70 + i * 13, 2);
      let x = 316;
      for (const e of [...s.ents].sort((p, q) => p.score - q.score)) {
        const w = drawText(ctx, String(e.score), x, 2, { color: '#ffffff', align: 'right', shadow: SHADOW });
        ctx.fillStyle = core.hex(e.slot);
        ctx.fillRect(x - w - 6, 3, 4, 4);
        x -= w + 12;
      }
      if (s.phase === ARCADE_PHASE.COUNTDOWN) {
        drawText(ctx, `GOLF ${s.wave}`, 160, 92, { color: '#ffe14d', scale: 3, align: 'center', shadow: '#ff3ea5' });
        drawText(ctx, 'HOUD ZE TEGEN! SPATIE = SCHIETEN', 160, 118, { color: '#ffffff', align: 'center', shadow: SHADOW });
      } else if (banner && s.phase !== ARCADE_PHASE.PLAY) {
        drawText(ctx, banner.text, 160, 92, { color: banner.color, scale: 2, align: 'center', shadow: SHADOW });
      } else if (core.mySlot() >= 0 && core.mine() && !core.mine().alive) {
        drawText(ctx, 'GERAAKT! JE KOMT TERUG...', 160, 120, { color: '#ff4d6d', align: 'center', shadow: SHADOW });
      }
    },

    unmount() {},
  };
}

function drawStars() {
  const { canvas, ctx } = createLayer(INV.width, INV.height);
  ctx.fillStyle = '#05050f';
  ctx.fillRect(0, 0, INV.width, INV.height);
  for (let i = 0; i < 90; i++) {
    const x = (i * 97) % INV.width;
    const y = INV.top + ((i * 53) % (INV.height - INV.top));
    ctx.fillStyle = i % 5 ? '#3a3a6a' : '#a3a8d6';
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.fillStyle = '#3ef0ff';
  ctx.fillRect(0, INV.top - 1, INV.width, 1);
  return canvas;
}

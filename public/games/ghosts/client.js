// Spookjesdoolhof (client side): your chomper is predicted with the shared
// integer grid movement; ghosts and the others are interpolated.
import { MAZE, MAZE_W, MAZE_H, UNIT, PLAYER_SPEED, DIRS, stepMover, GHOST_MODE as M } from '../../../shared/games/ghosts.js';
import { dirFromAxes } from '../../../shared/games/snake.js';
import { createArcadeCore, ARCADE_PHASE } from '../common/arcade.js';
import { Predictor } from '../../js/core/predict.js';
import { drawText, roundRect } from '../../js/core/hudtext.js';
import { createFx } from '../../js/core/fx.js';
import { createSharpLayer } from '../../js/core/canvas.js';

export const meta = { width: 320, height: 180, pixelated: false, step: 1 / 30, touchButtons: [] };

const T = 7; // pixels per tile
const X0 = Math.floor((320 - MAZE_W * T) / 2);
const Y0 = 16;
const SHADOW = '#0b0b1e';
// Pale sheet ghosts, each with its own tint (they also behave differently).
const GHOST_COLORS = ['#f4dede', '#e6d4f4', '#d4ecf4', '#f4e4cc'];

const px = (u) => X0 + (u / UNIT) * T + T / 2;
const py = (u) => Y0 + (u / UNIT) * T + T / 2;

function decode(r, time) {
  const s = { time, phase: r.u8(), endsAt: 0, ents: [], ghosts: [] };
  s.endsAt = time + r.f32() * 1000;
  s.level = r.u8();
  s.lives = r.u8();
  s.fright = r.u8() / 10;
  s.fruit = r.u8() === 1;
  const n = r.u8();
  for (let i = 0; i < n; i++) {
    s.ents.push({ slot: r.u8(), flags: r.u8(), ack: r.u16(), x: r.i16(), y: r.i16(), dir: r.i8(), want: r.i8(), alive: r.u8() === 1, score: r.u16() });
  }
  for (let i = 0; i < 4; i++) s.ghosts.push({ id: i, x: r.i16(), y: r.i16(), dir: r.i8(), mode: r.u8() });
  s.dots = new Uint8Array(MAZE_W * MAZE_H);
  for (let i = 0; i < s.dots.length; i += 4) {
    const v = r.u8();
    for (let k = 0; k < 4 && i + k < s.dots.length; k++) s.dots[i + k] = (v >> (k * 2)) & 3;
  }
  return s;
}

// Interpolate unless something jumped (tunnel, respawn).
const smooth = (a, b, t) => (Math.abs(b - a) > UNIT * 3 ? b : a + (b - a) * t);

export function createGame() {
  const predictor = new Predictor({
    create: () => ({ x: 0, y: 0, dir: 2, want: -1 }),
    copy: (d, s) => { d.x = s.x; d.y = s.y; d.dir = s.dir; d.want = s.want; },
    step: (s, inp) => {
      const d = dirFromAxes(inp.ax, inp.ay);
      if (d >= 0) s.want = d;
      stepMover(s, PLAYER_SPEED);
    },
  });
  const core = createArcadeCore({
    decode, predictor,
    toServer: (e, out) => { out.x = e.x; out.y = e.y; out.dir = e.dir; out.want = e.want; },
  });
  let ctx, input, sfx, fx, maze;
  let time = 0;
  let banner = null;
  let lastWaka = 0;

  function drawChomper(x, y, dir, color, open, isMe) {
    const a = dir >= 0 ? [0, Math.PI / 2, Math.PI, -Math.PI / 2][dir] : 0;
    const mouth = 0.15 + open * 0.55;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, 3.6, a + mouth, a + Math.PI * 2 - mouth);
    ctx.closePath();
    ctx.fill();
    // Eye
    const ea = a - Math.PI / 2 * 0.6;
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(x + Math.cos(ea) * 1.7, y + Math.sin(ea) * 1.7, 0.55, 0, Math.PI * 2);
    ctx.fill();
    if (isMe) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(x - 1.6, y - 7.2);
      ctx.lineTo(x + 1.6, y - 7.2);
      ctx.lineTo(x, y - 5.6);
      ctx.closePath();
      ctx.fill();
    }
  }

  // A sheet ghost: dome, wavy hem, eyes looking where it goes. Frightened:
  // dark blue with a wobbly mouth. Eaten: only the eyes fly home.
  function drawGhost(x, y, g, fright) {
    const r = 3.4;
    if (g.mode !== M.EYES) {
      let body = GHOST_COLORS[g.id];
      if (g.mode === M.FRIGHT) body = fright < 2 && Math.floor(time * 6) % 2 ? '#f4f4f4' : '#3a4a9a';
      const wave = Math.floor(time * 8) % 2 ? 0.7 : -0.7;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(x, y + r + 1, r, 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = body;
      ctx.globalAlpha = g.mode === M.FRIGHT ? 1 : 0.92;
      ctx.beginPath();
      ctx.arc(x, y - 0.6, r, Math.PI, 0);
      ctx.lineTo(x + r, y + r - 0.4);
      for (let k = 0; k < 4; k++) {
        const x0 = x + r - (k * 2 * r) / 4;
        ctx.quadraticCurveTo(x0 - r / 4, y + r + (k % 2 ? -wave : wave), x0 - r / 2, y + r - 0.4);
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (g.mode === M.FRIGHT) {
      ctx.fillStyle = '#ffd8e0';
      ctx.fillRect(x - 1.6, y - 1.5, 1, 1);
      ctx.fillRect(x + 0.6, y - 1.5, 1, 1);
      ctx.strokeStyle = '#ffd8e0';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(x - 2, y + 1.3);
      for (let k = 1; k <= 4; k++) ctx.lineTo(x - 2 + k, y + 1.3 + (k % 2 ? -0.5 : 0));
      ctx.stroke();
      return;
    }
    const [dx, dy] = g.dir >= 0 ? DIRS[g.dir] : [0, 0];
    for (const side of [-1, 1]) {
      const ex = x + side * 1.3;
      const ey = y - 1;
      ctx.fillStyle = g.mode === M.EYES ? '#f4f4f4' : '#2a1a2e';
      ctx.beginPath();
      ctx.ellipse(ex, ey, 0.9, 1.15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = g.mode === M.EYES ? '#3a2a4a' : '#d8453a';
      ctx.beginPath();
      ctx.arc(ex + dx * 0.4, ey + dy * 0.5, 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return {
    mount(view, net, c) {
      ctx = view.ctx;
      input = c.input;
      sfx = c.sfx;
      core.mount(net, c);
      fx = createFx({ reducedMotion: c.reducedMotion, smooth: true });
      maze = createSharpLayer(view, drawMaze);
    },

    onSnapshot(snap) {
      const prev = core.latest;
      const s = core.onSnapshot(snap);
      if (prev && s.level !== prev.level) core.reset();
      // Chomp sound while you are eating dots.
      const me = core.mine();
      if (prev && me && prev.dots && performance.now() - lastWaka > 180) {
        let eaten = 0;
        for (let i = 0; i < s.dots.length; i++) if (prev.dots[i] && !s.dots[i]) eaten++;
        if (eaten) { sfx.play('hover'); lastWaka = performance.now(); }
      }
    },

    onEvent(msg) {
      const slot = core.mySlot();
      switch (msg.e) {
        case 'go': sfx.play('go'); banner = null; break;
        case 'level': banner = null; break;
        case 'power': sfx.play('item'); break;
        case 'eatGhost':
          sfx.play('coin');
          fx.text(String(msg.p), px(msg.x), py(msg.y) - 4, '#ffd27a', 1, 1);
          break;
        case 'die':
          sfx.play(msg.s === slot ? 'lose' : 'hit');
          fx.burst(px(msg.x), py(msg.y), core.hex(msg.s), 20, { speed: 40, life: 0.7 });
          break;
        case 'fruitOn': sfx.play('ready'); break;
        case 'fruit': sfx.play('win'); fx.text(String(msg.p), px(13 * UNIT), py(13 * UNIT) - 6, '#ff4d6d', 1, 1.2); break;
        case 'spawn': if (msg.s === slot) sfx.play('join'); break;
        case 'roundEnd': banner = { text: 'LEVEL KLAAR!', color: '#ffd27a' }; sfx.play('win'); break;
        case 'end': banner = { text: 'GAME OVER', color: '#ff4d6d' }; sfx.play('lose'); break;
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
      if (core.latest?.phase === ARCADE_PHASE.PLAY && me?.alive && predictor.ready) core.send(inp.ax, inp.ay, 0);
      else core.idle();
    },

    render(alpha) {
      maze.blit(ctx);
      const s = core.latest;
      const sample = core.sample();
      if (s) {
        // Candy dots and pumpkins (the power pills).
        const blink = Math.floor(time * 4) % 2;
        for (let i = 0; i < s.dots.length; i++) {
          const d = s.dots[i];
          if (!d) continue;
          const x = X0 + (i % MAZE_W) * T + 3;
          const y = Y0 + Math.floor(i / MAZE_W) * T + 3;
          if (d === 1) {
            ctx.fillStyle = '#ffd27a';
            ctx.beginPath();
            ctx.arc(x + 0.5, y + 0.5, 0.75, 0, Math.PI * 2);
            ctx.fill();
          } else {
            // A little pumpkin
            ctx.fillStyle = blink ? '#ff9a2a' : '#e8781a';
            ctx.beginPath();
            ctx.ellipse(x + 0.5, y + 0.8, 2.2, 1.8, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(120, 50, 10, 0.6)';
            ctx.lineWidth = 0.35;
            ctx.beginPath();
            ctx.moveTo(x + 0.5, y - 0.8); ctx.lineTo(x + 0.5, y + 2.4);
            ctx.stroke();
            ctx.fillStyle = '#3c8a45';
            ctx.fillRect(x + 0.2, y - 1.6, 0.7, 1);
          }
        }
        if (s.fruit) {
          const x = px(13 * UNIT);
          const y = py(13 * UNIT);
          // Cherries
          ctx.fillStyle = '#d62839';
          ctx.beginPath(); ctx.arc(x - 1.6, y + 1.5, 1.6, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(x + 2.4, y + 0.6, 1.6, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#3c8a45';
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(x - 1.6, y); ctx.quadraticCurveTo(x - 0.5, y - 3, x + 0.8, y - 3.6);
          ctx.moveTo(x + 2.4, y - 0.8); ctx.quadraticCurveTo(x + 1.8, y - 2.6, x + 0.8, y - 3.6);
          ctx.stroke();
        }
      }
      if (s && sample) {
        const a = sample.a.state;
        const b = sample.b.state;
        for (const gb of b.ghosts) {
          const ga = a.ghosts[gb.id] ?? gb;
          drawGhost(px(smooth(ga.x, gb.x, sample.t)), py(smooth(ga.y, gb.y, sample.t)), gb, s.fright);
        }
        const open = Math.abs(Math.sin(time * 14));
        for (const eb of b.ents) {
          if (!eb.alive) continue;
          const ea = core.find(a.ents, eb.slot) ?? eb;
          const me = eb.slot === core.mySlot() && predictor.ready;
          const x = me ? predictor.get('x', alpha) : smooth(ea.x, eb.x, sample.t);
          const y = me ? predictor.get('y', alpha) : smooth(ea.y, eb.y, sample.t);
          const dir = me ? predictor.state.dir : eb.dir;
          drawChomper(px(x), py(y), dir, core.hex(eb.slot), open, eb.slot === core.mySlot());
        }
      }
      fx.drawParticles(ctx);
      if (s) this.hud(s);
      fx.drawTexts(ctx);
    },

    hud(s) {
      drawText(ctx, `LEVEL ${s.level}`, 4, 3, { color: '#ffffff', shadow: SHADOW });
      for (let i = 0; i < Math.min(s.lives, 9); i++) {
        ctx.fillStyle = '#ffe14d';
        ctx.beginPath();
        ctx.moveTo(8 + i * 8, 20);
        ctx.arc(8 + i * 8, 20, 3, 0.5, Math.PI * 2 - 0.5);
        ctx.fill();
      }
      let y = 3;
      for (const e of [...s.ents].sort((p, q) => q.score - p.score)) {
        ctx.fillStyle = core.hex(e.slot);
        roundRect(ctx, 252, y + 1, 4.5, 5, 1);
        ctx.fill();
        drawText(ctx, `${core.name(e.slot).slice(0, 6)} ${e.score}`, 259, y, { color: e.alive ? '#ffffff' : '#8a8fb8' });
        y += 10;
      }
      if (s.phase === ARCADE_PHASE.COUNTDOWN) {
        drawText(ctx, 'KLAAR?', 160, Y0 + 12.5 * T - 3, { color: '#ffe14d', align: 'center', shadow: SHADOW });
      } else if (banner && s.phase !== ARCADE_PHASE.PLAY) {
        drawText(ctx, banner.text, 160, Y0 + 12.5 * T - 3, { color: banner.color, align: 'center', shadow: SHADOW });
      } else if (core.mine() && !core.mine().alive) {
        drawText(ctx, s.lives > 0 ? 'OEPS! EVEN GEDULD...' : 'GEEN LEVENS MEER', 160, 172, { color: '#ff4d6d', align: 'center', shadow: SHADOW });
      }
    },

    unmount() {},
  };
}

// A haunted house: wooden floorboards, stone walls with a lit top edge
// wherever a wall meets a corridor, and a moon in the night outside.
function drawMaze(ctx) {
  ctx.fillStyle = '#140e1c';
  ctx.fillRect(0, 0, 320, 180);
  ctx.fillStyle = '#f4ecd0';
  ctx.beginPath();
  ctx.arc(24, 150, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#140e1c';
  ctx.beginPath();
  ctx.arc(29, 146, 9, 0, Math.PI * 2);
  ctx.fill();
  for (let y = 0; y < MAZE_H; y++) {
    for (let x = 0; x < MAZE_W; x++) {
      if (MAZE.walls[y * MAZE_W + x] === 1) continue;
      ctx.fillStyle = y % 2 ? '#2e2228' : '#33262c';
      ctx.fillRect(X0 + x * T, Y0 + y * T, T, T);
      if ((x + y * 3) % 5 === 0) {
        ctx.fillStyle = '#261c21';
        ctx.fillRect(X0 + x * T, Y0 + y * T, 0.4, T);
      }
    }
  }
  const wall = (x, y) => x >= 0 && y >= 0 && x < MAZE_W && y < MAZE_H && MAZE.walls[y * MAZE_W + x] === 1;
  for (let y = 0; y < MAZE_H; y++) {
    for (let x = 0; x < MAZE_W; x++) {
      const w = MAZE.walls[y * MAZE_W + x];
      const X = X0 + x * T;
      const Y = Y0 + y * T;
      if (w === 2) {
        ctx.fillStyle = '#8a6a4a';
        ctx.fillRect(X, Y + 3, T, 0.8);
        continue;
      }
      if (w !== 1) continue;
      ctx.fillStyle = (x + y) % 3 ? '#4a4458' : '#46405a';
      ctx.fillRect(X, Y, T, T);
      ctx.fillStyle = '#3a3448';
      ctx.fillRect(X, Y + (x % 2 ? 2.3 : 4.6), T, 0.45);
      ctx.fillRect(X + (y % 2 ? 2 : 5), Y, 0.45, T);
      ctx.fillStyle = '#7a7290';
      if (!wall(x, y - 1)) ctx.fillRect(X, Y, T, 0.7);
      if (!wall(x - 1, y)) ctx.fillRect(X, Y, 0.7, T);
      ctx.fillStyle = '#241f2e';
      if (!wall(x, y + 1)) ctx.fillRect(X, Y + T - 0.7, T, 0.7);
      if (!wall(x + 1, y)) ctx.fillRect(X + T - 0.7, Y, 0.7, T);
    }
  }
}

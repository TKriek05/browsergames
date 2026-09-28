// Drawing for Kwek Kwek Knal on a 320×180 pixel canvas: a sky that turns
// from morning into sunset over the rounds, drifting clouds, ducks, reeds in
// front, crosshairs, the HUD and Koos the frog at the end of a round.
import { createLayer } from '../../js/core/canvas.js';
import { drawText } from '../../js/core/pixelfont.js';
import { createFx } from '../../js/core/fx.js';
import { DUCK_FIELD, DUCK_STATE, AMMO } from '../../../shared/games/duckshoot.js';
import { createDuckSprites, createFrog, createCloud } from './sprites.js';

const SKIES = [
  { top: '#4aa8ff', bottom: '#d8f1ff', sun: '#fff3a0', hill1: '#7fc8a0', hill2: '#4fa874', trees: '#2f8a52' },
  { top: '#3a7fe0', bottom: '#ffe0a8', sun: '#ffd23e', hill1: '#8fb88a', hill2: '#5c9a62', trees: '#3a7d45' },
  { top: '#2a1f66', bottom: '#ff8a5c', sun: '#ff4d6d', hill1: '#6b3f7a', hill2: '#4a2c5e', trees: '#2c1d45' },
];
const SHADOW = '#0b0b1e';
const W = DUCK_FIELD.width;
const H = DUCK_FIELD.height;
const GRASS = DUCK_FIELD.grassY;
const PANEL_Y = 163;

export function createDuckRenderer(view, { reducedMotion }) {
  const { ctx } = view;
  const ducks = createDuckSprites();
  const frogs = { happy: createFrog('happy'), laugh: createFrog('laugh') };
  const foreground = drawForeground();
  const skies = new Map();
  const cloudSprites = [createCloud(34, 14), createCloud(26, 11), createCloud(42, 16)];
  const clouds = Array.from({ length: 5 }, (_, i) => ({ x: i * 70 + 10, y: 12 + ((i * 37) % 50), speed: 3 + (i % 3) * 2, sprite: cloudSprites[i % 3] }));
  const fx = createFx({ max: 260, reducedMotion });
  let time = 0;
  let sx = 0;
  let sy = 0;

  function sky(idx) {
    if (!skies.has(idx)) skies.set(idx, drawSky(SKIES[idx]));
    return skies.get(idx);
  }

  return {
    fx,

    update(dt) {
      time += dt;
      fx.update(dt);
      for (const c of clouds) {
        c.x += c.speed * dt * (reducedMotion ? 0.3 : 1);
        if (c.x > W + 10) c.x = -c.sprite.width - 10;
      }
    },

    begin(skyIndex) {
      sx = fx.shakeX();
      sy = fx.shakeY();
      ctx.save();
      ctx.translate(sx, sy);
      ctx.drawImage(sky(skyIndex), 0, 0);
      for (const c of clouds) ctx.drawImage(c.sprite, Math.round(c.x), c.y);
    },

    duck(x, y, type, state, left, id) {
      let pose;
      if (state === DUCK_STATE.HIT) pose = 3;
      else if (state === DUCK_STATE.FALL) pose = 4;
      else {
        const speed = state === DUCK_STATE.ESCAPE ? 16 : 10;
        const f = Math.floor(time * speed + id * 1.7) % 4;
        pose = f === 3 ? 1 : f;
      }
      const frame = (left ? ducks.left : ducks.right)[type][pose];
      const px = Math.round(x) - 8;
      let py = Math.round(y) - 8;
      if (type === 3 && state !== DUCK_STATE.FALL) {
        // The rubber duck hangs from a balloon and bobs gently.
        py += reducedMotion ? 0 : Math.round(Math.sin(time * 3 + id) * 1.5);
        if (state !== DUCK_STATE.HIT) {
          ctx.fillStyle = '#e0e0f0';
          ctx.fillRect(px + 8, py - 7, 1, 8);
          ctx.fillStyle = SHADOW;
          ctx.fillRect(px + 5, py - 14, 7, 7);
          ctx.fillStyle = '#ff4d6d';
          ctx.fillRect(px + 6, py - 13, 5, 5);
          ctx.fillStyle = '#ffb3c1';
          ctx.fillRect(px + 7, py - 12, 1, 1);
        }
      }
      ctx.drawImage(frame, px, py);
    },

    foreground() {
      ctx.drawImage(foreground, 0, 0);
    },

    crosshair(x, y, color, me) {
      const px = Math.round(x);
      const py = Math.round(y);
      const r = me ? 6 : 4;
      const gap = me ? 2 : 1;
      ctx.fillStyle = SHADOW;
      ctx.fillRect(px - r - 1, py - 1, r - gap + 1, 3);
      ctx.fillRect(px + gap + 1, py - 1, r - gap + 1, 3);
      ctx.fillRect(px - 1, py - r - 1, 3, r - gap + 1);
      ctx.fillRect(px - 1, py + gap + 1, 3, r - gap + 1);
      ctx.fillStyle = color;
      ctx.fillRect(px - r, py, r - gap, 1);
      ctx.fillRect(px + gap + 1, py, r - gap, 1);
      ctx.fillRect(px, py - r, 1, r - gap);
      ctx.fillRect(px, py + gap + 1, 1, r - gap);
      if (me) {
        ctx.fillRect(px, py, 1, 1);
        // Corner brackets make your own crosshair stand out.
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          ctx.fillRect(px + dx * 5, py + dy * 5, 1, 1);
          ctx.fillRect(px + dx * 4, py + dy * 5, 1, 1);
          ctx.fillRect(px + dx * 5, py + dy * 4, 1, 1);
        }
      }
    },

    // Expanding ring where a shot landed.
    shotRing(x, y, color) {
      fx.burst(x, y, color, 10, { speed: 50, life: 0.18, drag: 0.8 });
    },

    feathers(x, y, type) {
      const colors = type === 3 ? ['#ff4d6d', '#ffe14d'] : type === 2 ? ['#ffd23e', '#ffffff'] : ['#ffffff', '#c89a62'];
      for (let i = 0; i < (reducedMotion ? 5 : 14); i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 20 + Math.random() * 50;
        fx.spawn(x, y, Math.cos(a) * v, Math.sin(a) * v - 20, 0.8 + Math.random() * 0.6, colors[i % 2], 1 + (i % 2), 40, 0.94);
      }
    },

    hud({ round, rounds, coop, roundHits, roundTotal, quota, players, me, ammo, reloading, reloadProgress, spectator }) {
      drawText(ctx, `RONDE ${round}/${rounds}`, 4, 4, { color: '#ffffff', shadow: SHADOW });
      if (coop) {
        const good = roundHits >= quota;
        drawText(ctx, `RAAK ${roundHits}/${roundTotal}  NODIG ${quota}`, W - 4, 4, { color: good ? '#5dff8a' : '#ffe14d', align: 'right', shadow: SHADOW });
      }
      if (spectator) drawText(ctx, 'JE KIJKT MEE', W / 2, 4, { color: '#ffe14d', align: 'center', shadow: SHADOW });

      // Bottom panel: ammo on the left, scores on the right.
      ctx.fillStyle = 'rgba(11,11,30,0.72)';
      ctx.fillRect(0, PANEL_Y, W, H - PANEL_Y);
      ctx.fillStyle = '#3ef0ff';
      ctx.fillRect(0, PANEL_Y, W, 1);
      let x = 5;
      if (me) {
        if (reloading) {
          drawText(ctx, 'HERLADEN', 5, PANEL_Y + 4, { color: '#ffe14d' });
          ctx.fillStyle = '#2a2a5c';
          ctx.fillRect(5, PANEL_Y + 12, 44, 3);
          ctx.fillStyle = '#ffe14d';
          ctx.fillRect(5, PANEL_Y + 12, Math.round(44 * reloadProgress), 3);
        } else {
          for (let i = 0; i < AMMO.MAGAZINE; i++) {
            const full = i < ammo;
            ctx.fillStyle = full ? '#ff4d6d' : '#2a2a5c';
            ctx.fillRect(x + i * 9, PANEL_Y + 4, 5, 7);
            ctx.fillStyle = full ? '#ffd23e' : '#2a2a5c';
            ctx.fillRect(x + i * 9, PANEL_Y + 11, 5, 3);
          }
        }
        x = 58;
      }
      const slotW = Math.floor((W - x - 2) / Math.max(1, players.length));
      players.forEach((p, i) => {
        const px = x + i * slotW;
        ctx.fillStyle = p.color;
        ctx.fillRect(px, PANEL_Y + 5, 5, 5);
        if (p.isMe) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(px, PANEL_Y + 12, 5, 1);
        }
        const label = slotW > 60 ? `${p.name.slice(0, 7)} ${p.score}` : String(p.score);
        drawText(ctx, label, px + 8, PANEL_Y + 4, { color: p.connected ? '#ffffff' : '#8a8fb8' });
      });
    },

    // Round intro: "RONDE 2" with the countdown.
    intro(round, left) {
      drawText(ctx, `RONDE ${round}`, W / 2, 50, { color: '#ffe14d', scale: 3, align: 'center', shadow: '#ff3ea5' });
      if (left > 0) drawText(ctx, String(Math.ceil(left)), W / 2, 84, { color: '#ffffff', scale: 4, align: 'center', shadow: SHADOW });
    },

    // Round end: the frog rises from the reeds and comments.
    outro({ hits, total, coop, ok, age }) {
      const rise = reducedMotion ? 1 : Math.min(1, age / 0.5);
      const mood = hits === total || (coop && ok) ? 'happy' : 'laugh';
      const frog = frogs[mood];
      const fy = Math.round(GRASS + 8 - rise * 30);
      const hop = mood === 'laugh' && !reducedMotion ? Math.round(Math.abs(Math.sin(age * 12))) : 0;
      ctx.save();
      ctx.translate(W / 2 - 16, fy - hop);
      ctx.scale(2, 2);
      ctx.drawImage(frog, 0, 0);
      ctx.restore();
      ctx.drawImage(foreground, 0, GRASS - 16, W, 30, 0, GRASS - 16, W, 30);
      drawText(ctx, `RAAK: ${hits} VAN ${total}`, W / 2, 46, { color: '#ffffff', scale: 2, align: 'center', shadow: SHADOW });
      let line = hits === total ? 'PERFECT!' : mood === 'laugh' ? 'HA HA HA!' : 'MOOI ZO!';
      if (coop) line = ok ? 'QUOTUM GEHAALD!' : 'QUOTUM NIET GEHAALD';
      drawText(ctx, line, W / 2, 66, { color: mood === 'happy' ? '#5dff8a' : '#ffe14d', scale: 2, align: 'center', shadow: SHADOW });
    },

    banner(text, sub) {
      drawText(ctx, text, W / 2, 56, { color: '#ffe14d', scale: 4, align: 'center', shadow: '#ff3ea5' });
      if (sub) drawText(ctx, sub, W / 2, 92, { color: '#ffffff', align: 'center', shadow: SHADOW });
    },

    end() {
      fx.drawParticles(ctx);
      fx.drawTexts(ctx);
      ctx.restore();
    },
  };
}

function drawSky(p) {
  const { canvas, ctx } = createLayer(W, H);
  // Banded gradient: a few flat colour steps look more "pixel" than a smooth one.
  const steps = 10;
  for (let i = 0; i < steps; i++) {
    ctx.fillStyle = mix(p.top, p.bottom, i / (steps - 1));
    ctx.fillRect(0, Math.floor((i * GRASS) / steps), W, Math.ceil(GRASS / steps) + 1);
  }
  // Sun
  const cx = 250;
  const cy = 58;
  for (let y = -14; y <= 14; y++) {
    for (let x = -14; x <= 14; x++) {
      if (x * x + y * y > 14 * 14 + 4) continue;
      ctx.fillStyle = p.sun;
      if (y > 3 && (y & 3) === 0) continue; // retro stripes in the lower half
      ctx.fillRect(cx + x, cy + y, 1, 1);
    }
  }
  // Hills (two layers) and a tree line
  hills(ctx, p.hill1, 108, 12, 0.021, 1.3);
  hills(ctx, p.hill2, 122, 9, 0.034, 4.1);
  ctx.fillStyle = p.trees;
  for (let x = -4; x < W + 8; x += 9) {
    const h = 6 + ((x * 7) % 5);
    for (let y = 0; y < h; y++) {
      const half = Math.round(Math.sin((y / h) * Math.PI) * 4);
      ctx.fillRect(x - half, GRASS - 12 - h + y, half * 2 + 1, 1);
    }
  }
  ctx.fillRect(0, GRASS - 12, W, 12);
  return canvas;
}

function hills(ctx, color, base, amp, freq, phase) {
  ctx.fillStyle = color;
  for (let x = 0; x < W; x++) {
    const top = Math.round(base - amp * (0.6 + 0.4 * Math.sin(x * freq + phase)) - amp * 0.4 * Math.sin(x * freq * 2.7 + phase * 2));
    ctx.fillRect(x, top, 1, GRASS - top);
  }
}

// Grass band + reeds + cattails in front of the ducks.
function drawForeground() {
  const { canvas, ctx } = createLayer(W, H);
  ctx.fillStyle = '#2fbf5b';
  ctx.fillRect(0, GRASS, W, H - GRASS);
  ctx.fillStyle = '#28a34e';
  for (let y = GRASS + 3; y < H; y += 4) ctx.fillRect(0, y, W, 1);
  // Jagged blades along the top edge
  for (let x = 0; x < W; x += 2) {
    const h = 2 + ((x * 13) % 5);
    ctx.fillStyle = x % 4 ? '#3fd46b' : '#228a42';
    ctx.fillRect(x, GRASS - h, 1, h);
  }
  // Reeds with cattails
  for (let i = 0; i < 26; i++) {
    const x = (i * 53 + 17) % W;
    const h = 10 + ((i * 7) % 9);
    ctx.fillStyle = '#3a7d2a';
    ctx.fillRect(x, GRASS - h, 1, h);
    if (i % 3 !== 0) {
      ctx.fillStyle = '#6b3f1d';
      ctx.fillRect(x - 1, GRASS - h - 1, 3, 5);
      ctx.fillStyle = '#8a5a2b';
      ctx.fillRect(x - 1, GRASS - h - 1, 1, 4);
    }
    ctx.fillStyle = '#4c9a36';
    ctx.fillRect(x + 1, GRASS - h + 5, 2, 1);
    ctx.fillRect(x + 3, GRASS - h + 4, 1, 1);
  }
  return canvas;
}

function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const c = [16, 8, 0].map((s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

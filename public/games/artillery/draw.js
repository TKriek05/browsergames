// Knalkanon drawing: a landscape per theme (green hills, desert, snowy
// mountains) with a sky, far hills and the sea, the destructible ground,
// cannons on wheels, shells and explosions. Game y points up; the screen
// y points down, so every y goes through sy().
import { ART } from '../../../shared/games/artillery.js';
import { roundRect } from '../../js/core/hudtext.js';

export const W = ART.WIDTH;
export const H = ART.HEIGHT;
export const sy = (y) => H - y;
const SEA = 7;

export const THEMES = {
  gras: {
    sky: ['#86c9f5', '#e8f6ff'], sun: '#fff3c4', far: ['#a9d39a', '#8cc27f'], top: '#5aa83e', topDark: '#3f8a2c',
    dirt: ['#94613a', '#6e4526'], rock: '#5a3a22', sea: '#3d8fd1', cloud: '#ffffff',
  },
  woestijn: {
    sky: ['#f7c27e', '#fff0d4'], sun: '#fff6d8', far: ['#e9c285', '#dcae6c'], top: '#ecc57c', topDark: '#d4a960',
    dirt: ['#cf9656', '#a86f38'], rock: '#8c5a2c', sea: '#3aa5c9', cloud: '#fff4e2',
  },
  sneeuw: {
    sky: ['#9dc7ec', '#eff6fc'], sun: '#ffffff', far: ['#c7d5e3', '#aebfd0'], top: '#f7fbff', topDark: '#d7e4ef',
    dirt: ['#8e97a3', '#6c7581'], rock: '#555d68', sea: '#4d86b0', cloud: '#ffffff',
  },
};

export function drawSky(ctx, th) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, th.sky[0]);
  g.addColorStop(1, th.sky[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = th.sun;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(W * 0.82, 70, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  // Clouds.
  ctx.fillStyle = th.cloud;
  for (const [x, y, s] of [[110, 70, 1], [330, 45, 0.8], [520, 90, 1.1]]) {
    ctx.globalAlpha = 0.85;
    for (const [dx, dy, r] of [[0, 0, 16], [18, -6, 20], [38, 0, 15], [18, 6, 14]]) {
      ctx.beginPath();
      ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  // Two layers of far hills.
  th.far.forEach((color, k) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) {
      const y = 180 + k * 40 + Math.sin(x * (0.009 + k * 0.004) + k * 2) * (38 - k * 10) + Math.sin(x * 0.031 + k) * 8;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  });
}

export function drawGround(ctx, terrain, th) {
  if (!terrain) return;
  const path = new Path2D();
  path.moveTo(0, H);
  for (let x = 0; x < terrain.length; x++) path.lineTo(x, sy(terrain[x]));
  path.lineTo(W, H);
  path.closePath();
  const g = ctx.createLinearGradient(0, H - 300, 0, H);
  g.addColorStop(0, th.dirt[0]);
  g.addColorStop(1, th.dirt[1]);
  ctx.fillStyle = g;
  ctx.fill(path);
  // Strata: a few darker bands that follow the surface.
  ctx.save();
  ctx.clip(path);
  ctx.strokeStyle = th.rock;
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 3;
  for (const depth of [26, 60, 104]) {
    ctx.beginPath();
    for (let x = 0; x < terrain.length; x += 6) {
      const y = sy(Math.max(0, terrain[x] - depth - Math.sin(x * 0.05) * 4));
      if (x) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
  // The top layer: grass, sand or snow.
  ctx.lineJoin = 'round';
  ctx.strokeStyle = th.topDark;
  ctx.lineWidth = 7;
  ctx.beginPath();
  for (let x = 0; x < terrain.length; x++) {
    if (x) ctx.lineTo(x, sy(terrain[x]) + 2.5);
    else ctx.moveTo(x, sy(terrain[x]) + 2.5);
  }
  ctx.stroke();
  ctx.strokeStyle = th.top;
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let x = 0; x < terrain.length; x++) {
    if (x) ctx.lineTo(x, sy(terrain[x]) + 1);
    else ctx.moveTo(x, sy(terrain[x]) + 1);
  }
  ctx.stroke();
}

export function drawSea(ctx, th, time) {
  ctx.fillStyle = th.sea;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 10) ctx.lineTo(x, sy(SEA) + Math.sin(x * 0.05 + time * 2) * 1.5);
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

// A cannon: two wooden wheels, a body in the player's colour, the barrel at `angle`.
export function drawCannon(ctx, c, color, { turn = false, time = 0, flash = 0, recoil = 0, wreck = false } = {}) {
  const x = c.x;
  const y = sy(c.y);
  const a = (-c.angle * Math.PI) / 180;
  ctx.save();
  if (turn) {
    // Bouncing arrow above whoever is playing.
    const b = Math.sin(time * 5) * 3;
    ctx.fillStyle = '#ffe14d';
    ctx.beginPath();
    ctx.moveTo(x, y - 34 + b);
    ctx.lineTo(x - 6, y - 43 + b);
    ctx.lineTo(x + 6, y - 43 + b);
    ctx.closePath();
    ctx.fill();
  }
  // Barrel.
  ctx.save();
  ctx.translate(x, y - 7);
  ctx.rotate(wreck ? 0.5 : a);
  ctx.translate(-recoil * 4, 0);
  ctx.fillStyle = wreck ? '#1d1e22' : '#2f3138';
  roundRect(ctx, -2, -2.6, 15, 5.2, 2.4);
  ctx.fill();
  ctx.fillStyle = '#44474f';
  ctx.fillRect(11, -3.2, 3, 6.4);
  if (recoil > 0.6) {
    // Muzzle flash.
    ctx.fillStyle = '#ffd23e';
    ctx.beginPath();
    ctx.moveTo(14, -4);
    ctx.lineTo(24 + recoil * 6, 0);
    ctx.lineTo(14, 4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // Body and wheels.
  ctx.fillStyle = wreck ? '#3a3a3e' : color;
  roundRect(ctx, x - 9, y - 11, 18, 8, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
  for (const dx of [-5.5, 5.5]) {
    ctx.beginPath();
    ctx.arc(x + dx, y - 3.5, 3.6, 0, Math.PI * 2);
    ctx.fillStyle = '#6b4a2b';
    ctx.fill();
    ctx.fillStyle = '#3a2a1a';
    ctx.beginPath();
    ctx.arc(x + dx, y - 3.5, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  if (flash > 0) {
    ctx.globalAlpha = flash;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, x - 10, y - 12, 20, 12, 4);
    ctx.fill();
  }
  ctx.restore();
}

export function drawHealth(ctx, x, y, hp, color) {
  const w = 26;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  roundRect(ctx, x - w / 2 - 1, sy(y) - 22, w + 2, 5, 2.5);
  ctx.fill();
  ctx.fillStyle = hp > 50 ? '#5dd26a' : hp > 25 ? '#ffd23e' : '#ff5c5c';
  roundRect(ctx, x - w / 2, sy(y) - 21, (w * hp) / ART.HP, 3, 1.5);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(x - w / 2 - 5, sy(y) - 21.5, 3, 4);
}

// Wind: an arrow at the top, longer and redder when it blows harder.
export function drawWind(ctx, wind) {
  const k = wind / ART.WIND_MAX;
  const cx = W / 2;
  const y = 18;
  ctx.fillStyle = 'rgba(20, 30, 40, 0.45)';
  roundRect(ctx, cx - 70, y - 11, 140, 22, 11);
  ctx.fill();
  const len = Math.abs(k) * 50;
  ctx.strokeStyle = Math.abs(k) > 0.6 ? '#ff8a6b' : '#ffffff';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - (Math.sign(k) * len) / 2, y);
  ctx.lineTo(cx + (Math.sign(k) * len) / 2, y);
  ctx.stroke();
  if (len > 2) {
    const tip = cx + (Math.sign(k) * len) / 2;
    ctx.beginPath();
    ctx.moveTo(tip + Math.sign(k) * 6, y);
    ctx.lineTo(tip - Math.sign(k) * 2, y - 5);
    ctx.lineTo(tip - Math.sign(k) * 2, y + 5);
    ctx.closePath();
    ctx.fill();
  }
}

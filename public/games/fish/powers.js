// Hapvis power-ups on screen: the drifting bubbles with an icon, the effects
// on a fish (spikes, magnet reach, turbo glow) and the icons in the HUD.
import { FISH_POWER, FISH_POWERS, FISH_POWER_RULES as PR } from '../../../shared/games/fish.js';
import { drawText } from '../../js/core/hudtext.js';

const TAU = Math.PI * 2;

// An icon for a power-up type, centred on (x, y), about 2 × s wide.
export function powerIcon(ctx, type, x, y, s) {
  const color = FISH_POWERS[type]?.color ?? '#ffffff';
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (type) {
    case FISH_POWER.TURBO: // lightning bolt
      ctx.beginPath();
      ctx.moveTo(s * 0.25, -s);
      ctx.lineTo(-s * 0.55, s * 0.15);
      ctx.lineTo(-s * 0.02, s * 0.15);
      ctx.lineTo(-s * 0.3, s);
      ctx.lineTo(s * 0.6, -s * 0.2);
      ctx.lineTo(s * 0.05, -s * 0.2);
      ctx.closePath();
      ctx.fill();
      break;
    case FISH_POWER.SPIKES: // spiky ball
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        const r = i % 2 ? s * 0.45 : s;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      break;
    case FISH_POWER.MAGNET: // horseshoe magnet
      ctx.lineWidth = s * 0.5;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.arc(0, -s * 0.05, s * 0.55, Math.PI, 0, true);
      ctx.lineTo(s * 0.55, -s * 0.75);
      ctx.moveTo(-s * 0.55, -s * 0.05);
      ctx.lineTo(-s * 0.55, -s * 0.75);
      ctx.stroke();
      ctx.fillStyle = '#f4f4f4';
      ctx.fillRect(-s * 0.8, -s * 0.95, s * 0.5, s * 0.3);
      ctx.fillRect(s * 0.3, -s * 0.95, s * 0.5, s * 0.3);
      break;
    case FISH_POWER.DOUBLE:
      drawText(ctx, '×2', 0, -s * 0.72, { color, scale: s / 5.5, align: 'center' });
      break;
    case FISH_POWER.GROW: // arrow up
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.85, 0);
      ctx.lineTo(s * 0.32, 0);
      ctx.lineTo(s * 0.32, s * 0.9);
      ctx.lineTo(-s * 0.32, s * 0.9);
      ctx.lineTo(-s * 0.32, 0);
      ctx.lineTo(-s * 0.85, 0);
      ctx.closePath();
      ctx.fill();
      break;
    default:
      break;
  }
  ctx.restore();
}

// A power-up bubble in the sea (world coordinates). It blinks before it pops.
export function drawPowerBubble(ctx, p, time) {
  const left = PR.LIFE_S - p.age;
  if (left < 3 && Math.sin(time * 18) < -0.3) return;
  const bob = Math.sin(time * 2.2 + p.id) * 2;
  const x = p.x;
  const y = p.y + bob;
  const r = PR.RADIUS * (1 + Math.sin(time * 3 + p.id) * 0.05);
  const color = FISH_POWERS[p.type]?.color ?? '#ffffff';
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r + 5, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(12, 40, 64, 0.55)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = 'rgba(230, 248, 255, 0.85)';
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.4, y - r * 0.45, r * 0.28, r * 0.16, -0.6, 0, TAU);
  ctx.fill();
  ctx.restore();
  powerIcon(ctx, p.type, x, y, r * 0.68);
}

// Effects under a fish: the magnet's reach and turbo glow.
export function drawFishAura(ctx, x, y, r, fx, fy, fish, time) {
  if (fish.magnet > 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 107, 107, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 7]);
    ctx.lineDashOffset = -time * 20;
    ctx.beginPath();
    ctx.arc(x, y, r + PR.MAGNET_RANGE, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
  if (fish.boost > 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 225, 77, 0.55)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      const ox = -fy * i * r * 0.55;
      const oy = fx * i * r * 0.55;
      const len = r * (1.2 + ((time * 7 + i * 0.37) % 1) * 0.8);
      ctx.beginPath();
      ctx.moveTo(x - fx * r * 1.8 + ox, y - fy * r * 1.8 + oy);
      ctx.lineTo(x - fx * (r * 1.8 + len) + ox, y - fy * (r * 1.8 + len) + oy);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (fish.spikes > 0) {
    // Spikes all around, slowly turning.
    ctx.save();
    ctx.fillStyle = '#c38bff';
    ctx.strokeStyle = 'rgba(40, 10, 60, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + time * 0.6;
      const b = a + TAU / n / 2;
      const c = a + TAU / n;
      ctx.moveTo(x + Math.cos(a) * r * 1.02, y + Math.sin(a) * r * 0.9);
      ctx.lineTo(x + Math.cos(b) * r * 1.62, y + Math.sin(b) * r * 1.45);
      ctx.lineTo(x + Math.cos(c) * r * 1.02, y + Math.sin(c) * r * 0.9);
    }
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

// HUD: your running power-ups with the seconds left, from (x, y) to the right.
export function drawPowerHud(ctx, fish, x, y, shadow) {
  const timers = [
    [FISH_POWER.TURBO, fish.boost],
    [FISH_POWER.SPIKES, fish.spikes],
    [FISH_POWER.MAGNET, fish.magnet],
    [FISH_POWER.DOUBLE, fish.double],
  ];
  for (const [type, t] of timers) {
    if (!(t > 0)) continue;
    ctx.fillStyle = 'rgba(8, 34, 51, 0.6)';
    ctx.beginPath();
    ctx.arc(x + 7, y + 7, 8, 0, TAU);
    ctx.fill();
    // Ring that runs out.
    ctx.strokeStyle = FISH_POWERS[type].color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x + 7, y + 7, 8, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, t / FISH_POWERS[type].seconds));
    ctx.stroke();
    powerIcon(ctx, type, x + 7, y + 7, 4.6);
    drawText(ctx, String(Math.ceil(t)), x + 18, y + 2, { color: '#ffffff', scale: 0.85, shadow });
    x += 32;
  }
}

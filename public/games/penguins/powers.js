// Pinguïnbotsen power-ups on screen: low-poly models for the items on the
// ice and the effects on a penguin (glove, stars), plus flat icons for the HUD.
import { MeshBuilder } from '../../js/gl/mesh.js';
import { PG_POWER, PG_POWERS } from '../../../shared/games/penguins.js';
import { drawText } from '../../js/core/hudtext.js';

const TAU = Math.PI * 2;

// One mesh per power-up type (index = type), about 7 units wide, centred on y = 0.
export function buildPowerMeshes() {
  const fish = new MeshBuilder();
  fish.color('#ffb347').sphere(0, 0, 0, 2.6, 8, 5).sphere(1.8, 0, 0, 1.8, 7, 4);
  fish.color('#ff8a1f').face([[-2, 0, 0], [-4.8, 2.2, 0], [-4.8, -2.2, 0]], [0, 0, 1]).face([[-2, 0, 0], [-4.8, -2.2, 0], [-4.8, 2.2, 0]], [0, 0, -1]);
  fish.color('#10141c').sphere(2.9, 0.6, 1.1, 0.45, 4, 3).sphere(2.9, 0.6, -1.1, 0.45, 4, 3);

  const grip = new MeshBuilder(); // a crampon: a plate with spikes
  grip.color('#9fd8ff').box(0, -0.6, 0, 6, 1, 3.4);
  grip.color('#e8f4ff');
  for (const x of [-2.2, 0, 2.2]) for (const z of [-1.2, 1.2]) grip.cone(x, -2.6, z, 0.7, 2, 4);
  grip.color('#5a6a7a').box(0, 0.4, 0, 6.4, 0.6, 0.8);

  const heavy = new MeshBuilder(); // a kettlebell weight
  heavy.color('#4a4e5c').sphere(0, -0.5, 0, 3.2, 9, 6);
  heavy.color('#6a7080').box(-2, 2, 0, 0.9, 2.4, 0.9).box(2, 2, 0, 0.9, 2.4, 0.9).box(0, 4, 0, 4.9, 0.9, 0.9);
  heavy.color('#ffe14d', { emissive: 0.4 }).box(0, -0.5, 3.1, 2.2, 1.2, 0.3);

  const glove = new MeshBuilder();
  buildGlove(glove, 0, 0, 0, 1);

  const shock = new MeshBuilder(); // a glowing star
  shock.color('#ffe14d', { emissive: 0.9 }).octa(0, 0, 0, 2.2, 3.4);
  shock.color('#fff6b0', { emissive: 1 }).octa(0, 0, 0, 3.6, 1.1).octa(0, 0, 0, 1.1, 1.1);
  return [fish.build(), grip.build(), heavy.build(), glove.build(), shock.build()];
}

// A red boxing glove pointing +x.
function buildGlove(b, x, y, z, s) {
  b.color('#ff4a4a').sphere(x + 0.6 * s, y, z, 2.6 * s, 8, 6).sphere(x + 1.8 * s, y + 0.9 * s, z + 1.4 * s, 1.2 * s, 6, 4);
  b.color('#f4f4f4').cylinder(x - 2 * s, y - 1.8 * s, z, 1.8 * s, 3.4 * s, 8);
  return b;
}

// Effect meshes on a penguin: the glove it holds, and stars around a stunned head.
export function buildEffectMeshes() {
  const glove = buildGlove(new MeshBuilder(), 0, 0, 0, 0.7).build();
  const star = new MeshBuilder().color('#ffe14d', { emissive: 0.9 }).octa(0, 0, 0, 1, 1).build();
  return { glove, star };
}

// Flat HUD icon for a power-up type around (x, y), about 2s wide.
export function powerIcon(ctx, type, x, y, s) {
  const color = PG_POWERS[type]?.color ?? '#ffffff';
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  switch (type) {
    case PG_POWER.TURBO: // fish
      ctx.beginPath();
      ctx.ellipse(s * 0.15, 0, s * 0.65, s * 0.42, 0, 0, TAU);
      ctx.moveTo(-s * 0.4, 0);
      ctx.lineTo(-s, -s * 0.5);
      ctx.lineTo(-s, s * 0.5);
      ctx.closePath();
      ctx.fill();
      break;
    case PG_POWER.GRIP: // crampon
      ctx.fillRect(-s * 0.9, -s * 0.35, s * 1.8, s * 0.35);
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const px = -s * 0.75 + i * s * 0.5;
        ctx.moveTo(px - s * 0.18, 0);
        ctx.lineTo(px, s * 0.65);
        ctx.lineTo(px + s * 0.18, 0);
      }
      ctx.fill();
      break;
    case PG_POWER.HEAVY: // kettlebell
      ctx.beginPath();
      ctx.arc(0, s * 0.2, s * 0.62, 0, TAU);
      ctx.fill();
      ctx.lineWidth = s * 0.22;
      ctx.beginPath();
      ctx.arc(0, -s * 0.45, s * 0.38, Math.PI, 0);
      ctx.stroke();
      break;
    case PG_POWER.PUNCH: // glove
      ctx.beginPath();
      ctx.arc(s * 0.1, -s * 0.1, s * 0.62, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#f4f4f4';
      ctx.fillRect(-s * 0.55, s * 0.35, s * 0.9, s * 0.45);
      break;
    case PG_POWER.SHOCK: // star
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU - Math.PI / 2;
        const r = i % 2 ? s * 0.42 : s;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      break;
    default:
      break;
  }
  ctx.restore();
}

// HUD: your running power-ups, from (x, y) to the right.
export function drawPowerHud(ctx, timers, x, y, shadow) {
  for (const [type, t] of timers) {
    if (!(t > 0)) continue;
    ctx.fillStyle = 'rgba(16, 38, 58, 0.6)';
    ctx.beginPath();
    ctx.arc(x + 7, y + 7, 8, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = PG_POWERS[type].color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x + 7, y + 7, 8, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, t / PG_POWERS[type].seconds));
    ctx.stroke();
    powerIcon(ctx, type, x + 7, y + 7, 4.8);
    drawText(ctx, String(Math.ceil(t)), x + 18, y + 2, { color: '#ffffff', scale: 0.85, shadow });
    x += 32;
  }
}

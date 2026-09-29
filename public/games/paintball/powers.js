// Spetterveld power-ups on screen: the pad (a round plate), a model per
// power-up that floats above it, and flat icons with timers for the HUD.
import { MeshBuilder } from '../../js/gl/mesh.js';
import { PB_POWER, PB_POWERS, PB_POWER_RULES as PR } from '../../../shared/games/paintball.js';
import { drawText } from '../../js/core/hudtext.js';

const TAU = Math.PI * 2;
const SHADOW = '#101418';

export function buildPad() {
  const b = new MeshBuilder();
  b.color('#3a3d45').cylinder(0, 0, 0, 7.5, 0.5, 16, { top: '#4a4e58' });
  b.color('#ffffff', { emissive: 0.5, tint: 1 }).cylinder(0, 0.5, 0, 5.2, 0.12, 16);
  return b.build();
}

// One model per type (index = type), about 5 units big, centred on y = 0.
export function buildPowerModels() {
  const rapid = new MeshBuilder(); // three balls in a row, like a burst
  rapid.color('#ff8a1e', { emissive: 0.25 }).sphere(-2.4, 0, 0, 1.3, 7, 5).sphere(0, 0, 0, 1.5, 7, 5).sphere(2.6, 0, 0, 1.7, 7, 5);
  rapid.color('#ffd23e', { emissive: 0.6 }).octa(4.6, 0, 0, 0.9, 0.9);

  const spread = new MeshBuilder(); // a fan of three balls
  spread.color('#b36bff', { emissive: 0.25 });
  for (const a of [-0.45, 0, 0.45]) spread.sphere(Math.cos(a) * 3, 0, Math.sin(a) * 3, 1.3, 7, 5);
  spread.color('#e0c8ff').box(-1.2, -0.4, 0, 2.4, 0.8, 0.8);

  const armor = new MeshBuilder(); // a vest
  armor.color('#9fb4c8').box(0, -2.6, 0, 2.4, 5.2, 5);
  armor.color('#6f8599').box(0, 1.4, -1.9, 2.2, 1.4, 1.2).box(0, 1.4, 1.9, 2.2, 1.4, 1.2);
  armor.color('#ffe14d', { emissive: 0.3 }).box(1.25, -0.8, 0, 0.1, 1, 3);

  const sprint = new MeshBuilder(); // a winged shoe
  sprint.color('#2bd4a4', { emissive: 0.2 }).box(0, -1.6, 0, 5, 1.6, 2.2).box(-1.2, 0, 0, 2.4, 1.8, 2.2);
  sprint.color('#ffffff').box(0, -2.5, 0, 5.4, 0.5, 2.4);
  sprint.color('#e8fff8').face([[-2.2, 1, 1.2], [-4.4, 3.2, 1.2], [-1.2, 2, 1.2]], [0, 0, 1]).face([[-2.2, 1, -1.2], [-1.2, 2, -1.2], [-4.4, 3.2, -1.2]], [0, 0, -1]);

  const camo = new MeshBuilder(); // a bush-like ball of leaves
  const leaves = ['#5f8f3a', '#8fbf5a', '#4a7a2e'];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU;
    camo.color(leaves[i % 3]).octa(Math.cos(a) * 1.6, Math.sin(i * 1.7) * 1.2, Math.sin(a) * 1.6, 1.6, 1.6);
  }
  camo.color('#6fa347').sphere(0, 0, 0, 1.8, 6, 4);
  return [rapid.build(), spread.build(), armor.build(), sprint.build(), camo.build()];
}

// Flat HUD icon for a type around (x, y), about 2s wide.
export function powerIcon(ctx, type, x, y, s) {
  const color = PB_POWERS[type]?.color ?? '#ffffff';
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  const dot = (dx, dy, r) => {
    ctx.beginPath();
    ctx.arc(dx, dy, r, 0, TAU);
    ctx.fill();
  };
  switch (type) {
    case PB_POWER.RAPID:
      dot(-s * 0.6, 0, s * 0.3);
      dot(0, 0, s * 0.36);
      dot(s * 0.62, 0, s * 0.42);
      break;
    case PB_POWER.SPREAD:
      for (const a of [-0.6, 0, 0.6]) dot(Math.sin(a) * s * 0.75, -Math.cos(a) * s * 0.55 + s * 0.2, s * 0.3);
      break;
    case PB_POWER.ARMOR:
      ctx.beginPath();
      ctx.moveTo(-s * 0.75, -s * 0.8);
      ctx.lineTo(s * 0.75, -s * 0.8);
      ctx.lineTo(s * 0.7, s * 0.2);
      ctx.quadraticCurveTo(0, s * 1.05, -s * 0.7, s * 0.2);
      ctx.closePath();
      ctx.fill();
      break;
    case PB_POWER.SPRINT:
      ctx.beginPath();
      ctx.moveTo(-s * 0.9, s * 0.5);
      ctx.lineTo(s * 0.9, s * 0.5);
      ctx.lineTo(s * 0.8, 0);
      ctx.lineTo(-s * 0.1, -s * 0.1);
      ctx.lineTo(-s * 0.3, -s * 0.7);
      ctx.lineTo(-s * 0.9, -s * 0.6);
      ctx.closePath();
      ctx.fill();
      break;
    case PB_POWER.CAMO:
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        dot(Math.cos(a) * s * 0.45, Math.sin(a) * s * 0.45, s * 0.42);
      }
      break;
    default:
      break;
  }
  ctx.restore();
}

// HUD: running power-ups ([type, value] pairs; armor counts hits, the rest seconds).
export function drawPowerHud(ctx, timers, x, y) {
  for (const [type, t] of timers) {
    if (!(t > 0)) continue;
    const full = type === PB_POWER.ARMOR ? PR.ARMOR : PB_POWERS[type].seconds;
    ctx.fillStyle = 'rgba(15, 18, 24, 0.6)';
    ctx.beginPath();
    ctx.arc(x + 7, y + 7, 8, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = PB_POWERS[type].color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x + 7, y + 7, 8, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, t / full));
    ctx.stroke();
    powerIcon(ctx, type, x + 7, y + 7, 4.8);
    drawText(ctx, type === PB_POWER.ARMOR ? `×${t}` : String(Math.ceil(t)), x + 18, y + 2, { color: '#ffffff', scale: 0.85, shadow: SHADOW });
    x += 32;
  }
}

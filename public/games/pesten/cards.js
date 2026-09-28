// Playing cards drawn with vector shapes (own designs): suits as paths,
// corner indices, a big pip or a face letter in the middle, a jester star
// for the joker and a patterned back.
import { roundRect } from '../board/draw.js';
import { isJoker, rankOf, suitOf } from '../../../shared/rules/pesten.js';

const RED = '#c8282e';
const BLACK = '#1d1f24';
const LABELS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'B', 'V', 'H'];
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const suitColor = (suit) => (suit === 0 || suit === 1 ? RED : BLACK);

// A suit symbol centred at (x, y), `s` = its height.
export function suitPath(ctx, suit, x, y, s) {
  const k = s / 2;
  ctx.beginPath();
  if (suit === 0) {
    // Heart
    ctx.moveTo(x, y + k * 0.95);
    ctx.bezierCurveTo(x - k * 1.5, y - k * 0.1, x - k * 0.75, y - k * 1.25, x, y - k * 0.45);
    ctx.bezierCurveTo(x + k * 0.75, y - k * 1.25, x + k * 1.5, y - k * 0.1, x, y + k * 0.95);
  } else if (suit === 1) {
    // Diamond
    ctx.moveTo(x, y - k);
    ctx.quadraticCurveTo(x + k * 0.35, y - k * 0.3, x + k * 0.72, y);
    ctx.quadraticCurveTo(x + k * 0.35, y + k * 0.3, x, y + k);
    ctx.quadraticCurveTo(x - k * 0.35, y + k * 0.3, x - k * 0.72, y);
    ctx.quadraticCurveTo(x - k * 0.35, y - k * 0.3, x, y - k);
  } else if (suit === 2) {
    // Club: three leaves and a stem
    const r = k * 0.42;
    ctx.arc(x, y - k * 0.45, r, 0, Math.PI * 2);
    ctx.moveTo(x - k * 0.45 + r, y + k * 0.12);
    ctx.arc(x - k * 0.45, y + k * 0.12, r, 0, Math.PI * 2);
    ctx.moveTo(x + k * 0.45 + r, y + k * 0.12);
    ctx.arc(x + k * 0.45, y + k * 0.12, r, 0, Math.PI * 2);
    ctx.moveTo(x - k * 0.12, y);
    ctx.lineTo(x - k * 0.3, y + k);
    ctx.lineTo(x + k * 0.3, y + k);
    ctx.lineTo(x + k * 0.12, y);
  } else {
    // Spade: an upside-down heart and a stem
    ctx.moveTo(x, y - k);
    ctx.bezierCurveTo(x + k * 1.45, y - k * 0.05, x + k * 0.7, y + k * 0.95, x + k * 0.05, y + k * 0.35);
    ctx.lineTo(x + k * 0.3, y + k);
    ctx.lineTo(x - k * 0.3, y + k);
    ctx.lineTo(x - k * 0.05, y + k * 0.35);
    ctx.bezierCurveTo(x - k * 0.7, y + k * 0.95, x - k * 1.45, y - k * 0.05, x, y - k);
  }
  ctx.closePath();
}

export function drawSuit(ctx, suit, x, y, s, color = suitColor(suit)) {
  suitPath(ctx, suit, x, y, s);
  ctx.fillStyle = color;
  ctx.fill();
}

function star(ctx, x, y, r, points = 5) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

// One face-up card with its top-left corner at (x, y).
export function drawCard(ctx, card, x, y, w, h, { glow = null, dim = false } = {}) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  roundRect(ctx, x + 1.5, y + 3, w, h, w * 0.09);
  ctx.fill();
  roundRect(ctx, x, y, w, h, w * 0.09);
  ctx.fillStyle = '#fdfbf5';
  ctx.fill();
  ctx.strokeStyle = glow ?? 'rgba(0,0,0,0.25)';
  ctx.lineWidth = glow ? 3 : 1;
  ctx.stroke();
  ctx.textBaseline = 'top';
  if (isJoker(card)) {
    const colors = ['#c8282e', '#1d6fd8', '#e0a21a', '#2e9b4a'];
    for (let i = 0; i < 4; i++) {
      star(ctx, x + w / 2 + Math.cos(i * 1.57 + 0.8) * w * 0.2, y + h / 2 + Math.sin(i * 1.57 + 0.8) * w * 0.2, w * 0.13);
      ctx.fillStyle = colors[i];
      ctx.fill();
    }
    star(ctx, x + w / 2, y + h / 2, w * 0.2);
    ctx.fillStyle = '#7a3fc0';
    ctx.fill();
    ctx.font = `800 ${w * 0.15}px ${FONT}`;
    ctx.fillStyle = '#7a3fc0';
    ctx.textAlign = 'left';
    ctx.fillText('J', x + w * 0.08, y + w * 0.06);
    ctx.fillText('K', x + w * 0.08, y + w * 0.22);
    ctx.textAlign = 'center';
    ctx.font = `800 ${w * 0.13}px ${FONT}`;
    ctx.fillText('JOKER', x + w / 2, y + h - w * 0.2);
  } else {
    const suit = suitOf(card);
    const r = rankOf(card);
    const color = suitColor(suit);
    ctx.fillStyle = color;
    ctx.font = `800 ${w * 0.2}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(LABELS[r], x + w * 0.07, y + w * 0.06);
    drawSuit(ctx, suit, x + w * 0.15, y + w * 0.36, w * 0.14, color);
    ctx.save();
    ctx.translate(x + w, y + h);
    ctx.rotate(Math.PI);
    ctx.fillText(LABELS[r], w * 0.07, w * 0.06);
    drawSuit(ctx, suit, w * 0.15, w * 0.36, w * 0.14, color);
    ctx.restore();
    if (r >= 11) {
      // Face card: a framed panel with the letter and a small crown.
      const px = x + w * 0.24;
      const py = y + h * 0.2;
      roundRect(ctx, px, py, w * 0.52, h * 0.6, 4);
      ctx.fillStyle = suit < 2 ? '#fbe3dc' : '#e2e6ee';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = '#e0a21a';
      ctx.beginPath();
      const cx = x + w / 2;
      const cy = py + h * 0.13;
      ctx.moveTo(cx - w * 0.14, cy + w * 0.06);
      ctx.lineTo(cx - w * 0.14, cy - w * 0.05);
      ctx.lineTo(cx - w * 0.07, cy);
      ctx.lineTo(cx, cy - w * 0.08);
      ctx.lineTo(cx + w * 0.07, cy);
      ctx.lineTo(cx + w * 0.14, cy - w * 0.05);
      ctx.lineTo(cx + w * 0.14, cy + w * 0.06);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.font = `800 ${w * 0.3}px ${FONT}`;
      ctx.fillText(LABELS[r], cx, py + h * 0.24);
    } else {
      drawSuit(ctx, suit, x + w / 2, y + h / 2, w * 0.42, color);
    }
  }
  if (dim) {
    roundRect(ctx, x, y, w, h, w * 0.09);
    ctx.fillStyle = 'rgba(20, 30, 25, 0.28)';
    ctx.fill();
  }
  ctx.restore();
}

export function drawBack(ctx, x, y, w, h) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  roundRect(ctx, x + 1.5, y + 3, w, h, w * 0.09);
  ctx.fill();
  roundRect(ctx, x, y, w, h, w * 0.09);
  ctx.fillStyle = '#fdfbf5';
  ctx.fill();
  const m = w * 0.07;
  roundRect(ctx, x + m, y + m, w - m * 2, h - m * 2, w * 0.06);
  ctx.fillStyle = '#23508f';
  ctx.fill();
  ctx.clip();
  ctx.strokeStyle = 'rgba(210, 225, 255, 0.35)';
  ctx.lineWidth = 1.2;
  for (let k = -h; k < w + h; k += 8) {
    ctx.beginPath();
    ctx.moveTo(x + k, y);
    ctx.lineTo(x + k - h, y + h);
    ctx.moveTo(x + k - h, y);
    ctx.lineTo(x + k, y + h);
    ctx.stroke();
  }
  ctx.restore();
}

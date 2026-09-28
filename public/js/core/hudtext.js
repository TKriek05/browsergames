// Smooth HUD text for the games that are not pixel art (3D games, table
// games). Same call signature as pixelfont.drawText, so a game can switch by
// changing its import. Units are the game's logical pixels; the canvas is
// scaled for the screen, so the text stays sharp at any size.
// The shadow colour is used as a soft outline for legibility on busy scenes.

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SIZE = 8.5; // font size at scale 1 (≈ the height of the 7 px pixel font)

function font(scale) {
  return `700 ${SIZE * scale}px ${FONT}`;
}

export function measureText(text, scale = 1, ctx = measureCtx()) {
  ctx.font = font(scale);
  return ctx.measureText(String(text)).width;
}

let scratch = null;
function measureCtx() {
  scratch = scratch ?? document.createElement('canvas').getContext('2d');
  return scratch;
}

// Draws text with its top at y; returns the width (like pixelfont.drawText).
export function drawText(ctx, text, x, y, { color = '#fff', scale = 1, align = 'left', shadow = null } = {}) {
  const str = String(text);
  ctx.save();
  ctx.font = font(scale);
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  const w = ctx.measureText(str).width;
  if (shadow) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.6 * scale;
    ctx.strokeStyle = shadow;
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
  ctx.restore();
  return w;
}

// Small vector shapes for smooth HUDs.
export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// A heart centred at (x, y), `s` wide.
export function heart(ctx, x, y, s) {
  const k = s / 2;
  ctx.beginPath();
  ctx.moveTo(x, y + k * 0.9);
  ctx.bezierCurveTo(x - k * 1.4, y - k * 0.1, x - k * 0.7, y - k * 1.2, x, y - k * 0.45);
  ctx.bezierCurveTo(x + k * 0.7, y - k * 1.2, x + k * 1.4, y - k * 0.1, x, y + k * 0.9);
  ctx.closePath();
}

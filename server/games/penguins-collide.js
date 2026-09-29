// Pinguïnbotsen collisions (server only). Everyone has already moved this
// tick (a human may have sent more than one input); here the paths are
// replayed in small sub-steps so two fast penguins can not slide through
// each other, and a few relaxation passes untangle a pile-up of three or
// more. A penguin that did not bump ends exactly where its own movement put
// it, so the owner's prediction stays spot on.
import { PG, bump } from '../../shared/games/penguins.js';

const MAX_SUBSTEPS = 8;
const RELAX_PASSES = 3;
const f = Math.fround;

// ents: the living entities, each with `s` (penguin state) and `px/py`
// (where it started this tick). massOf(e) → collision mass.
// onHit(a, b, impact, nx, ny, va, vb): a bumped into b; n = normal a → b,
// va/vb = how fast each one was moving towards the other before the bump.
export function collide(ents, dt, massOf, onHit) {
  const n = ents.length;
  if (n < 2) return;
  // Sub-steps: at most half a radius of relative movement per step.
  let maxMove = 0;
  for (const e of ents) maxMove = Math.max(maxMove, Math.hypot(e.s.x - e.px, e.s.y - e.py));
  const steps = Math.max(1, Math.min(MAX_SUBSTEPS, Math.ceil((maxMove * 2) / (PG.RADIUS * 0.5))));
  for (const e of ents) {
    e.endX = e.s.x;
    e.endY = e.s.y;
    e.stepX = (e.s.x - e.px) / steps;
    e.stepY = (e.s.y - e.py) / steps;
    e.s.x = e.px;
    e.s.y = e.py;
    e.bumped = false;
  }
  for (let k = 0; k < steps; k++) {
    for (const e of ents) {
      e.s.x += e.stepX;
      e.s.y += e.stepY;
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (!pair(ents[i], ents[j], massOf, onHit)) continue;
        // From here on they follow their new speed.
        for (const e of [ents[i], ents[j]]) {
          e.stepX = (e.s.vx * dt) / steps;
          e.stepY = (e.s.vy * dt) / steps;
        }
      }
    }
  }
  for (const e of ents) {
    if (e.bumped) {
      e.s.x = f(e.s.x);
      e.s.y = f(e.s.y);
    } else {
      e.s.x = e.endX;
      e.s.y = e.endY;
    }
  }
  // Pile-ups: push apart until nobody overlaps (or we give up).
  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    let any = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = ents[i];
        const b = ents[j];
        const dx = b.s.x - a.s.x;
        const dy = b.s.y - a.s.y;
        if (dx * dx + dy * dy >= PG.RADIUS * PG.RADIUS * 4) continue;
        any = true;
        pair(a, b, massOf, onHit);
      }
    }
    if (!any) break;
  }
}

// One pair: bump if they touch. Returns true when there was contact.
function pair(a, b, massOf, onHit) {
  const dx = b.s.x - a.s.x;
  const dy = b.s.y - a.s.y;
  const d2 = dx * dx + dy * dy;
  const min = PG.RADIUS * 2;
  if (d2 >= min * min) return false;
  const d = Math.sqrt(d2) || 1;
  const nx = dx / d;
  const ny = dy / d;
  const va = a.s.vx * nx + a.s.vy * ny;
  const vb = -(b.s.vx * nx + b.s.vy * ny);
  const impact = bump(a.s, b.s, massOf(a), massOf(b));
  a.bumped = true;
  b.bumped = true;
  if (impact > 0) onHit(a, b, impact, nx, ny, va, vb);
  return true;
}

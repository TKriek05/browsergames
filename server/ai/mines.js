// Mijnenveger bot: classic single-cell deductions on the public view
// (safe neighbours / certain mines), otherwise the least risky guess.
import rules, { neighbours } from '../../shared/rules/mines.js';

// Chance of a blind click instead of thinking (per move).
const CARELESS = { easy: 0.06, normal: 0.015, hard: 0 };

export default {
  worker: false,
  pick(state, seat, level, rng) {
    const v = rules.view(state, seat);
    const { cols, rows, cells, flags } = v;
    const n = cells.length;
    const hidden = (c) => cells[c] === null && flags[c] === -1;
    const unknown = [];
    for (let c = 0; c < n; c++) if (hidden(c)) unknown.push(c);
    if (!unknown.length) return null;

    // First move: somewhere in the middle.
    if (cells.every((x) => x === null)) {
      const cx = Math.floor(cols / 2) + Math.floor(rng() * 3) - 1;
      const cy = Math.floor(rows / 2) + Math.floor(rng() * 3) - 1;
      return { t: 'r', c: cy * cols + cx };
    }
    if (rng() < (CARELESS[level] ?? 0.08)) return { t: 'r', c: unknown[Math.floor(rng() * unknown.length)] };

    const risk = new Map();
    for (let c = 0; c < n; c++) {
      const num = cells[c];
      if (typeof num !== 'number' || num === 0) continue;
      const nbs = neighbours(cols, rows, c);
      const flagged = nbs.filter((x) => flags[x] !== -1 || cells[x] === 'M').length;
      const open = nbs.filter(hidden);
      if (!open.length) continue;
      if (flagged === num) return { t: 'r', c: open[Math.floor(rng() * open.length)] };
      if (num - flagged === open.length && level !== 'easy') return { t: 'f', c: open[0] };
      const p = (num - flagged) / open.length;
      for (const x of open) risk.set(x, Math.max(risk.get(x) ?? 0, p));
    }
    // Cells nobody knows anything about: the global mine density.
    const minesLeft = v.mineCount - flags.filter((f) => f !== -1).length - v.exploded.length;
    const density = Math.max(0.01, minesLeft / unknown.length);
    let best = unknown[0];
    let bestP = Infinity;
    for (const c of unknown) {
      const p = (risk.get(c) ?? density) + rng() * 0.01;
      if (p < bestP) { bestP = p; best = c; }
    }
    return { t: 'r', c: best };
  },
};

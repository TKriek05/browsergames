// Onthoud 'm bot. It only uses the public view: cards on the table and the
// log of recent flips (everyone saw those). Its level decides how many of
// those flips it "remembers".
import rules from '../../shared/rules/memory.js';

const MEMORY = { easy: 3, normal: 10, hard: 40 };
const SLIP = { easy: 0.25, normal: 0.08, hard: 0 }; // chance to forget a known pair

export default {
  worker: false,
  pick(state, seat, level, rng) {
    const view = rules.view(state, seat);
    const legal = rules.legalMoves(state, seat);
    if (!legal.length) return null;
    const known = new Map(); // card index → symbol (still on the table)
    for (const { c, s } of view.log.slice(-(MEMORY[level] ?? 10))) {
      if (view.owner[c] === -1) known.set(c, s);
    }
    const isLegal = (c) => legal.some((m) => m.c === c);
    const slip = rng() < (SLIP[level] ?? 0.08);

    if (view.open.length === 1) {
      // Second card: do we remember where its partner is?
      const first = view.open[0];
      const sym = view.cards[first];
      for (const [c, s] of known) {
        if (c !== first && s === sym && isLegal(c) && !slip) return { c };
      }
    } else if (!slip) {
      // First card: flip one half of a pair we already know completely.
      const bySym = new Map();
      for (const [c, s] of known) {
        if (!isLegal(c)) continue;
        if (bySym.has(s)) return { c: bySym.get(s) };
        bySym.set(s, c);
      }
    }
    // Otherwise explore: prefer cards we have never seen.
    const unseen = legal.filter((m) => !known.has(m.c));
    const pool = unseen.length ? unseen : legal;
    return pool[Math.floor(rng() * pool.length)];
  },
};

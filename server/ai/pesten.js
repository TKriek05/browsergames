// Pesten bot: scores every playable card. Plain cards from long suits go
// first; bully cards are saved for when they hurt most (the next player is
// almost out) or to defend against a stack; a jack picks the suit it holds
// most of. Easy bots mostly play something random.
import rules, { isJoker, rankOf, suitOf } from '../../shared/rules/pesten.js';

const NOISE = { easy: 30, normal: 6, hard: 0 };

export default {
  worker: false,
  pick(state, seat, level, rng) {
    const legal = rules.legalMoves(state, seat);
    const plays = legal.filter((m) => m.type === 'play');
    const other = legal.find((m) => m.type !== 'play');
    if (!plays.length) return other ?? null;
    if (level === 'easy' && rng() < 0.6) return plays[Math.floor(rng() * plays.length)];

    const hand = state.hands[seat];
    const suits = [0, 0, 0, 0];
    for (const c of hand) if (!isJoker(c) && rankOf(c) !== 11) suits[suitOf(c)]++;
    const next = ((state.turn + state.dir) % state.n + state.n) % state.n;
    const nextCards = state.hands[next].length;
    const danger = nextCards <= 2 ? 1 : nextCards <= 4 ? 0.4 : 0;

    const score = (m) => {
      const c = m.card;
      const r = rankOf(c);
      let v = 10;
      if (state.pending > 0) return isJoker(c) ? 8 : 12; // stack back; keep the joker if a 2 does it
      if (isJoker(c)) v += -14 + danger * 26;
      else if (r === 2) v += -3 + danger * 14;
      else if (r === 8) v += 1 + danger * 10;
      else if (r === 7) {
        // Only nice when there is a follow-up.
        const rest = hand.filter((x) => x !== c);
        v += rest.some((x) => !isJoker(x) && (suitOf(x) === suitOf(c) || rankOf(x) === 7)) ? 7 : -4;
      } else if (r === 1) v += 1 + (state.n > 2 ? danger * 6 : 3);
      else if (r === 11) v += -16 + suits[m.suit] * 4;
      if (!isJoker(c) && r !== 11) {
        v += suits[suitOf(c)] * 2; // follow-ups in this suit
        v += r > 10 ? 1 : r * 0.08;
      }
      if (hand.length === 2) v += isJoker(c) || r === 11 ? -6 : 2; // keep a wildcard for the last card
      return v + (rng() - 0.5) * (NOISE[level] ?? 6);
    };
    let best = plays[0];
    let bestScore = -Infinity;
    for (const m of plays) {
      const v = score(m);
      if (v > bestScore) {
        bestScore = v;
        best = m;
      }
    }
    // Hard bots may keep a lone jack in hand instead of wasting it.
    if (level === 'hard' && best.type === 'play' && rankOf(best.card) === 11 && plays.length === 4 && !state.pending && hand.length > 3 && other?.type === 'draw') return other;
    return best;
  },
};

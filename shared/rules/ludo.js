// Erger je niet! (inspired by the classic "mens-erger-je-niet"), 2-4 players.
// Pure rules module (interface: see shared/rules/tictactoe.js).
//
// Pawn position (relative to its own colour):
//   -1 = in the base, 0-39 = on the track (0 = own start square),
//   40-43 = in the home lane. Absolute track square = (quadrant * 10 + pos) % 40.
// Rules (common Dutch house rules):
//   - roll a 6 to bring a pawn out; with nothing on the board you get 3 tries
//   - with a 6 you must bring a pawn out if you can, and you always roll again
//   - your start square must be cleared first when pawns are still waiting
//   - landing on an opponent sends it back; you cannot land on your own pawn
//   - the home lane needs an exact roll and you cannot jump your own pawns there
import { rollInt } from '../rng.js';

export const TRACK = 40;
export const LANE = 4;
const QUADRANTS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };

export const abs = (quad, pos) => (quad * 10 + pos) % TRACK;

function pawnAt(state, square) {
  for (let s = 0; s < state.pawns.length; s++) {
    for (let p = 0; p < 4; p++) {
      const pos = state.pawns[s][p];
      if (pos >= 0 && pos < TRACK && abs(state.quad[s], pos) === square) return { seat: s, pawn: p };
    }
  }
  return null;
}

// Where would this pawn go with `die`? null = not allowed.
export function target(state, seat, pawn, die) {
  const pos = state.pawns[seat][pawn];
  const quad = state.quad[seat];
  if (pos === -1) {
    if (die !== 6) return null;
    const occ = pawnAt(state, abs(quad, 0));
    return occ && occ.seat === seat ? null : 0;
  }
  const next = pos + die;
  if (next > TRACK + LANE - 1) return null; // overshoot
  if (next >= TRACK) {
    // Home lane: no jumping over or landing on own pawns.
    for (let p = 0; p < 4; p++) {
      const other = state.pawns[seat][p];
      if (p !== pawn && other >= TRACK && other > pos && other <= next) return null;
    }
    return next;
  }
  const occ = pawnAt(state, abs(quad, next));
  if (occ && occ.seat === seat) return null;
  return next;
}

export function movablePawns(state, seat, die) {
  const list = [];
  for (let p = 0; p < 4; p++) if (target(state, seat, p, die) !== null) list.push(p);
  if (!list.length) return list;
  const pawns = state.pawns[seat];
  // A 6 with pawns waiting: bringing one out is compulsory.
  if (die === 6) {
    const out = list.filter((p) => pawns[p] === -1);
    if (out.length) return [out[0]];
  }
  // Own pawn on the start square while others wait: it must move on.
  if (pawns.includes(-1)) {
    const onStart = list.find((p) => pawns[p] === 0);
    if (onStart !== undefined) return [onStart];
  }
  return list;
}

const onBoard = (pawns) => pawns.some((p) => p >= 0 && p < TRACK);
const progress = (pawns) => pawns.reduce((sum, p) => sum + (p < 0 ? 0 : p + 1), 0);

export default {
  id: 'ludo',
  undo: false,
  rankingScore: true,

  setup({ seats }) {
    return {
      quad: QUADRANTS[seats] ?? QUADRANTS[4].slice(0, seats),
      pawns: Array.from({ length: seats }, () => [-1, -1, -1, -1]),
      turn: 0,
      phase: 'roll',
      die: null,
      tries: 0,
      over: null,
    };
  },

  toMove: (state) => (state.over ? [] : [state.turn]),

  legalMoves(state, seat) {
    if (state.over || seat !== state.turn) return [];
    if (state.phase === 'roll') return [{ type: 'roll' }];
    return movablePawns(state, seat, state.die).map((pawn) => ({ type: 'move', pawn }));
  },

  apply(state, seat, move, rng) {
    const s = { ...state, pawns: state.pawns.map((p) => p.slice()) };
    const next = () => {
      s.turn = (seat + 1) % s.pawns.length;
      s.tries = 0;
    };

    if (move.type === 'roll') {
      const die = rollInt(rng, 1, 6);
      s.die = die;
      if (movablePawns(s, seat, die).length) {
        s.phase = 'move';
        return { state: s, info: { roll: die } };
      }
      // Nothing to move: roll again after a 6, or during the 3 tries.
      s.phase = 'roll';
      s.die = null;
      const noPawnsOut = !onBoard(s.pawns[seat]);
      if (die === 6) return { state: s, info: { roll: die, pass: true, again: true } };
      if (noPawnsOut && s.tries < 2) {
        s.tries++;
        return { state: s, info: { roll: die, pass: true, again: true, tries: s.tries } };
      }
      next();
      return { state: s, info: { roll: die, pass: true } };
    }

    // Move a pawn.
    const die = s.die;
    const from = s.pawns[seat][move.pawn];
    const to = target(s, seat, move.pawn, die);
    let captured = null;
    if (to < TRACK) {
      const occ = pawnAt(s, abs(s.quad[seat], to));
      if (occ && occ.seat !== seat) {
        s.pawns[occ.seat][occ.pawn] = -1;
        captured = occ;
      }
    }
    s.pawns[seat][move.pawn] = to;
    s.phase = 'roll';
    s.die = null;

    const info = { pawn: move.pawn, from, to, die, captured, again: die === 6 };
    if (s.pawns[seat].every((p) => p >= TRACK)) {
      // First one home wins; the others are ranked by how far they got.
      const ranking = [seat, ...s.pawns.map((_, i) => i).filter((i) => i !== seat).sort((a, b) => progress(s.pawns[b]) - progress(s.pawns[a]))];
      s.over = { winners: [seat], draw: false, reason: 'Alle pionnen thuis', ranking };
    } else if (die !== 6) next();
    else s.tries = 0;
    return { state: s, info };
  },

  result: (state) => state.over,
  view: (state) => state,
};

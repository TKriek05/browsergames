// Ganzenbord (the public-domain Game of the Goose), 2-6 players, two dice.
// Pure rules module (interface: see shared/rules/tictactoe.js).
//
// Classic Dutch squares:
//   geese 5 9 14 18 23 27 32 36 41 45 50 54 59: move the same throw again
//   6 brug → 12 · 19 herberg: skip a turn · 31 put and 52 gevangenis: stuck
//   until someone else arrives · 42 doolhof → 39 · 58 dood → back to start
//   63 finish, exact: throwing too many bounces you back.
//   First throw: 6+3 → 26, 5+4 → 53.
import { rollInt } from '../rng.js';

export const FINISH = 63;
export const GEESE = [5, 9, 14, 18, 23, 27, 32, 36, 41, 45, 50, 54, 59];
export const SPECIAL = {
  6: { name: 'Brug', to: 12 },
  19: { name: 'Herberg', skip: 1 },
  31: { name: 'Put', trap: true },
  42: { name: 'Doolhof', to: 39 },
  52: { name: 'Gevangenis', trap: true },
  58: { name: 'Dood', to: 0 },
};

export default {
  id: 'goose',
  undo: false,
  rankingScore: true,

  setup({ seats }) {
    return {
      pos: new Array(seats).fill(0),
      skip: new Array(seats).fill(0), // turns to sit out (herberg)
      stuck: new Array(seats).fill(false), // in the well or prison
      first: new Array(seats).fill(true),
      turn: 0,
      over: null,
    };
  },

  toMove: (state) => (state.over ? [] : [state.turn]),
  legalMoves: (state, seat) => (state.over || seat !== state.turn ? [] : [{ type: 'roll' }]),

  apply(state, seat, move, rng) {
    const s = {
      ...state,
      pos: state.pos.slice(),
      skip: state.skip.slice(),
      stuck: state.stuck.slice(),
      first: state.first.slice(),
    };
    const d1 = rollInt(rng, 1, 6);
    const d2 = rollInt(rng, 1, 6);
    const total = d1 + d2;
    const steps = []; // squares visited, for the animation
    const events = []; // what happened, for the text
    let at = s.pos[seat];

    if (s.first[seat] && total === 9) {
      at = (d1 === 6 || d2 === 6) ? 26 : 53;
      steps.push(at);
      events.push(`Eerste worp ${d1}+${d2}: door naar ${at}`);
    } else {
      let dir = 1;
      let remaining = total;
      // Walk the throw (bouncing back from 63), then apply geese repeatedly.
      for (let guard = 0; guard < 20; guard++) {
        for (let i = 0; i < remaining; i++) {
          if (at === FINISH) dir = -1;
          at += dir;
          steps.push(at);
        }
        if (at === FINISH || !GEESE.includes(at)) break;
        events.push(`Gans op ${at}: nog eens ${total}`);
        remaining = total;
      }
      const sq = SPECIAL[at];
      if (sq?.to !== undefined) {
        events.push(`${sq.name} op ${at}: naar ${sq.to}`);
        at = sq.to;
        steps.push(at);
      } else if (sq?.skip) {
        s.skip[seat] = sq.skip;
        events.push(`${sq.name}: een beurt overslaan`);
      } else if (sq?.trap) {
        // Whoever was stuck here is freed; now this player waits.
        for (let i = 0; i < s.pos.length; i++) {
          if (i !== seat && s.pos[i] === at && s.stuck[i]) {
            s.stuck[i] = false;
            events.push(`${sq.name}: speler ${i + 1} is bevrijd`);
          }
        }
        s.stuck[seat] = true;
        events.push(`${sq.name}: wachten tot iemand anders komt`);
      }
    }
    s.first[seat] = false;
    s.pos[seat] = at;

    if (at === FINISH) {
      const ranking = [seat, ...s.pos.map((_, i) => i).filter((i) => i !== seat).sort((a, b) => s.pos[b] - s.pos[a])];
      s.over = { winners: [seat], draw: false, reason: 'Eerst op 63', ranking };
      return { state: s, info: { dice: [d1, d2], steps, events, skipped: [] } };
    }

    // Next player who may actually move (herberg / put / gevangenis).
    const n = s.pos.length;
    const skipped = [];
    let next = seat;
    for (let tries = 0; tries < n * 3; tries++) {
      next = (next + 1) % n;
      if (s.stuck[next]) continue;
      if (s.skip[next] > 0) {
        s.skip[next]--;
        skipped.push(next);
        continue;
      }
      break;
    }
    if (s.stuck[next] || s.stuck.every((x) => x)) {
      // Everybody is stuck: free the next player so the game can go on.
      next = (seat + 1) % n;
      s.stuck[next] = false;
      events.push('Iedereen zit vast: de volgende speler mag weer');
    }
    s.turn = next;
    return { state: s, info: { dice: [d1, d2], steps, events, skipped } };
  },

  result: (state) => state.over,
  view: (state) => state,
};

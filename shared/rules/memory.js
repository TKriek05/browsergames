// Onthoud 'm (memory). Pure rules module, see tictactoe.js for the interface.
// A turn: flip two cards. A pair stays yours and you go again; otherwise
// both stay visible until the next player flips a card.
export const MEMORY_SIZES = {
  klein: { cols: 4, rows: 4 },
  normaal: { cols: 6, rows: 4 },
  groot: { cols: 6, rows: 6 },
};
export const SYMBOL_COUNT = 18;
const LOG_MAX = 40;

export default {
  id: 'memory',
  undo: false,
  rankingScore: true,

  setup({ seats, settings, rng }) {
    const size = MEMORY_SIZES[settings?.size] ?? MEMORY_SIZES.normaal;
    const pairs = (size.cols * size.rows) / 2;
    // Pick `pairs` different symbols, two of each, shuffled (Fisher-Yates).
    const symbols = Array.from({ length: SYMBOL_COUNT }, (_, i) => i);
    for (let i = symbols.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [symbols[i], symbols[j]] = [symbols[j], symbols[i]];
    }
    const cards = [];
    for (let i = 0; i < pairs; i++) cards.push(symbols[i], symbols[i]);
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return {
      cols: size.cols, rows: size.rows, cards,
      owner: new Array(cards.length).fill(-1),
      open: [], // flipped this turn (0-2)
      shown: [], // the last mismatch, visible until the next flip
      scores: new Array(seats).fill(0),
      turn: 0,
      seats,
      log: [], // recent flips { c, s }: public knowledge (everyone saw them)
      over: null,
    };
  },

  toMove(state) {
    return state.over ? [] : [state.turn];
  },

  legalMoves(state, seat) {
    if (state.over || seat !== state.turn) return [];
    const moves = [];
    for (let c = 0; c < state.cards.length; c++) {
      if (state.owner[c] === -1 && !state.open.includes(c)) moves.push({ c });
    }
    return moves;
  },

  apply(state, seat, move) {
    const c = move.c;
    const sym = state.cards[c];
    const owner = state.owner.slice();
    const scores = state.scores.slice();
    const log = [...state.log, { c, s: sym }].slice(-LOG_MAX);
    let open = [...state.open, c];
    let shown = open.length === 1 ? [] : state.shown;
    let turn = state.turn;
    let match = null;
    if (open.length === 2) {
      const [a, b] = open;
      match = state.cards[a] === state.cards[b];
      if (match) {
        owner[a] = seat;
        owner[b] = seat;
        scores[seat]++;
        shown = [];
      } else {
        shown = [a, b];
        turn = (turn + 1) % state.seats;
      }
      open = [];
    }
    let over = null;
    if (!owner.includes(-1)) {
      const best = Math.max(...scores);
      const winners = scores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0);
      const ranking = scores.map((s, i) => i).sort((x, y) => scores[y] - scores[x]);
      over = { winners, draw: winners.length > 1 && winners.length === state.seats, reason: `${best} ${best === 1 ? 'paar' : 'paren'}`, ranking };
    }
    return {
      state: { ...state, owner, scores, log, open, shown, turn, over },
      info: { c, sym, match },
    };
  },

  result(state) {
    return state.over;
  },

  // Unmatched cards stay face down unless they are open or just shown.
  view(state) {
    const visible = new Set([...state.open, ...state.shown]);
    return {
      cols: state.cols,
      rows: state.rows,
      cards: state.cards.map((s, c) => (state.owner[c] !== -1 || visible.has(c) ? s : null)),
      owner: state.owner,
      open: state.open,
      shown: state.shown,
      scores: state.scores,
      turn: state.turn,
      log: state.log,
    };
  },
};

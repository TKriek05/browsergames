// Mijnenveger, samen: everybody sweeps the same field at the same time
// (no turns). The first reveal is always safe. A mine costs the team a life;
// clear every safe cell to win together. Pure rules module.
export const MINE_SIZES = {
  klein: { cols: 9, rows: 9, mines: 10 },
  middel: { cols: 16, rows: 12, mines: 32 },
  groot: { cols: 24, rows: 14, mines: 62 },
};

export function neighbours(cols, rows, c) {
  const x = c % cols;
  const y = (c - x) / cols;
  const out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) out.push(ny * cols + nx);
    }
  }
  return out;
}

function ranking(scores) {
  return scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
}

export default {
  id: 'mines',
  undo: false,
  simultaneous: true,
  rankingScore: true,
  botPace: 2.2, // everyone plays at once: give the humans room

  setup({ seats, settings }) {
    const size = MINE_SIZES[settings?.size] ?? MINE_SIZES.middel;
    const n = size.cols * size.rows;
    const lives = settings?.lives ?? 3;
    return {
      cols: size.cols, rows: size.rows, mineCount: size.mines,
      mines: null, // placed on the first reveal
      counts: null,
      revealed: new Array(n).fill(-1), // seat that revealed the cell
      flags: new Array(n).fill(-1), // seat that placed a flag
      exploded: [],
      lives, livesMax: lives,
      scores: new Array(seats).fill(0), // safe cells revealed
      hits: new Array(seats).fill(0),
      safeLeft: n - size.mines,
      seats,
      over: null,
    };
  },

  toMove(state) {
    return state.over ? [] : Array.from({ length: state.seats }, (_, i) => i);
  },

  legalMoves() {
    return null; // too many to list; see isLegal
  },

  isLegal(state, seat, move) {
    if (state.over || !move || (move.t !== 'r' && move.t !== 'f')) return false;
    const c = move.c;
    if (!Number.isInteger(c) || c < 0 || c >= state.revealed.length) return false;
    if (state.revealed[c] !== -1) return false;
    if (move.t === 'r' && state.flags[c] !== -1) return false;
    return true;
  },

  apply(state, seat, move, rng) {
    const c = move.c;
    if (move.t === 'f') {
      const flags = state.flags.slice();
      flags[c] = flags[c] === -1 ? seat : -1;
      return { state: { ...state, flags }, info: { t: 'f', c, on: flags[c] !== -1 } };
    }

    let { mines, counts } = state;
    if (!mines) ({ mines, counts } = placeMines(state, c, rng));
    const revealed = state.revealed.slice();
    const scores = state.scores.slice();

    if (mines[c]) {
      const hits = state.hits.slice();
      hits[seat]++;
      revealed[c] = seat;
      const lives = state.lives - 1;
      const over = lives <= 0
        ? { winners: [], draw: false, reason: 'Boem! Alle levens zijn op.', ranking: ranking(scores) }
        : null;
      return {
        state: { ...state, mines, counts, revealed, hits, lives, exploded: [...state.exploded, c], over },
        info: { t: 'r', c, boom: true },
      };
    }

    // Flood fill from empty cells (0 neighbouring mines).
    const flags = state.flags.slice();
    const stack = [c];
    let opened = 0;
    while (stack.length) {
      const cur = stack.pop();
      if (revealed[cur] !== -1 || mines[cur]) continue;
      revealed[cur] = seat;
      flags[cur] = -1;
      opened++;
      if (counts[cur] === 0) for (const nb of neighbours(state.cols, state.rows, cur)) if (revealed[nb] === -1) stack.push(nb);
    }
    scores[seat] += opened;
    const safeLeft = state.safeLeft - opened;
    const over = safeLeft <= 0
      ? { winners: Array.from({ length: state.seats }, (_, i) => i), draw: false, reason: 'Het veld is veilig!', ranking: ranking(scores) }
      : null;
    return {
      state: { ...state, mines, counts, revealed, flags, scores, safeLeft, over },
      info: { t: 'r', c, n: opened },
    };
  },

  result(state) {
    return state.over;
  },

  // Numbers only for revealed cells; mines only when they exploded (or at the end).
  view(state) {
    const n = state.revealed.length;
    const show = new Array(n).fill(null);
    for (let c = 0; c < n; c++) {
      if (state.revealed[c] !== -1) show[c] = state.mines?.[c] ? 'M' : state.counts[c];
      else if (state.over && state.mines?.[c]) show[c] = 'm';
    }
    return {
      cols: state.cols, rows: state.rows, mineCount: state.mineCount,
      cells: show, revealed: state.revealed, flags: state.flags, exploded: state.exploded,
      lives: state.lives, livesMax: state.livesMax, scores: state.scores, hits: state.hits, safeLeft: state.safeLeft,
    };
  },
};

// Mines anywhere except the first cell and its neighbours.
function placeMines(state, first, rng) {
  const { cols, rows, mineCount } = state;
  const n = cols * rows;
  const keepFree = new Set([first, ...neighbours(cols, rows, first)]);
  const candidates = [];
  for (let c = 0; c < n; c++) if (!keepFree.has(c)) candidates.push(c);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const mines = new Array(n).fill(false);
  for (let i = 0; i < Math.min(mineCount, candidates.length); i++) mines[candidates[i]] = true;
  const counts = new Array(n).fill(0);
  for (let c = 0; c < n; c++) for (const nb of neighbours(cols, rows, c)) if (mines[nb]) counts[c]++;
  return { mines, counts };
}

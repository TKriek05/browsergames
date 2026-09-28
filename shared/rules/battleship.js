// Zeeslag (battleship) for 2 players on 10×10 grids. Both players place their
// fleet at the same time, then take turns firing. Hidden information: view()
// never shows the opponent's ships until they are sunk.
// Pure rules module (interface: see shared/rules/tictactoe.js).
export const SIZE = 10;
export const FLEET = [
  { name: 'Vliegdekschip', len: 5 },
  { name: 'Slagschip', len: 4 },
  { name: 'Kruiser', len: 3 },
  { name: 'Onderzeeër', len: 3 },
  { name: 'Torpedobootjager', len: 2 },
];

export function shipCells({ x, y, dir }, len) {
  const cells = [];
  for (let i = 0; i < len; i++) cells.push(dir === 'h' ? (y * SIZE + x + i) : ((y + i) * SIZE + x));
  return cells;
}

// ships: [{ x, y, dir }] in FLEET order. With `count` < 5 only the first
// ships are checked (used while placing one by one). Returns true when valid.
export function validPlacement(ships, touching = false, count = FLEET.length) {
  if (!Array.isArray(ships) || ships.length !== count) return false;
  const taken = new Set();
  const blocked = new Set();
  for (let i = 0; i < count; i++) {
    const s = ships[i];
    if (!s || !Number.isInteger(s.x) || !Number.isInteger(s.y) || (s.dir !== 'h' && s.dir !== 'v')) return false;
    const len = FLEET[i].len;
    if (s.x < 0 || s.y < 0 || (s.dir === 'h' ? s.x + len > SIZE : s.x >= SIZE) || (s.dir === 'v' ? s.y + len > SIZE : s.y >= SIZE)) return false;
    const cells = shipCells(s, len);
    for (const c of cells) if (taken.has(c) || (!touching && blocked.has(c))) return false;
    for (const c of cells) {
      taken.add(c);
      for (const n of neighbours(c)) blocked.add(n);
    }
  }
  return true;
}

export function neighbours(c) {
  const x = c % SIZE;
  const y = Math.floor(c / SIZE);
  const out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if ((dx || dy) && nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE) out.push(ny * SIZE + nx);
    }
  }
  return out;
}

export function randomPlacement(rng, touching = false) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const ships = [];
    let ok = true;
    for (let i = 0; i < FLEET.length && ok; i++) {
      let placed = false;
      for (let t = 0; t < 200 && !placed; t++) {
        const dir = rng() < 0.5 ? 'h' : 'v';
        const len = FLEET[i].len;
        const x = Math.floor(rng() * (dir === 'h' ? SIZE - len + 1 : SIZE));
        const y = Math.floor(rng() * (dir === 'v' ? SIZE - len + 1 : SIZE));
        const trial = [...ships, { x, y, dir }];
        if (validPlacement(trial, touching, trial.length)) {
          ships.push({ x, y, dir });
          placed = true;
        }
      }
      ok = placed;
    }
    if (ok) return ships;
  }
  throw new Error('no placement found');
}

const opponent = (seat) => 1 - seat;

export default {
  id: 'battleship',
  undo: false,

  setup({ settings = {} }) {
    return {
      touching: settings.touching === true,
      extraShot: settings.extraShot !== false,
      phase: 'place',
      ships: [null, null], // per seat: [{ x, y, dir, cells, hits }]
      shots: [new Array(SIZE * SIZE).fill(0), new Array(SIZE * SIZE).fill(0)], // shots ON seat's board: 0 none, 1 miss, 2 hit, 3 auto-miss
      turn: 0,
      over: null,
    };
  },

  toMove(state) {
    if (state.over) return [];
    if (state.phase === 'place') return [0, 1].filter((s) => !state.ships[s]);
    return [state.turn];
  },

  legalMoves(state, seat) {
    if (!this.toMove(state).includes(seat)) return [];
    if (state.phase === 'place') return null; // not enumerable: see isLegal
    const board = state.shots[opponent(seat)];
    const moves = [];
    for (let c = 0; c < SIZE * SIZE; c++) if (!board[c]) moves.push({ type: 'fire', c });
    return moves;
  },

  isLegal(state, seat, move) {
    if (!this.toMove(state).includes(seat) || !move) return false;
    if (state.phase === 'place') {
      if (move.type === 'random') return true;
      return move.type === 'place' && validPlacement(move.ships, state.touching);
    }
    return move.type === 'fire' && Number.isInteger(move.c) && move.c >= 0 && move.c < SIZE * SIZE && !state.shots[opponent(seat)][move.c];
  },

  apply(state, seat, move, rng) {
    const s = { ...state, ships: state.ships.slice(), shots: state.shots.map((b) => b.slice()) };
    if (state.phase === 'place') {
      const layout = move.type === 'random' ? randomPlacement(rng, s.touching) : move.ships;
      s.ships[seat] = layout.map((p, i) => ({ x: p.x, y: p.y, dir: p.dir, cells: shipCells(p, FLEET[i].len), hits: 0 }));
      if (s.ships[0] && s.ships[1]) s.phase = 'fire';
      return { state: s, info: { placed: true } };
    }

    const target = opponent(seat);
    const board = s.shots[target];
    const fleet = s.ships[target].map((sh) => ({ ...sh }));
    s.ships[target] = fleet;
    const ship = fleet.find((sh) => sh.cells.includes(move.c));
    let sunk = null;
    if (ship) {
      board[move.c] = 2;
      ship.hits++;
      if (ship.hits === ship.cells.length) {
        const index = fleet.indexOf(ship);
        sunk = { name: FLEET[index].name, cells: ship.cells };
        // Ships never touch: the water around a sunk ship is known.
        if (!s.touching) for (const c of ship.cells) for (const n of neighbours(c)) if (!board[n]) board[n] = 3;
      }
    } else board[move.c] = 1;

    const allSunk = fleet.every((sh) => sh.hits === sh.cells.length);
    if (allSunk) s.over = { winners: [seat], draw: false, reason: 'De hele vloot is gezonken' };
    else if (!ship || !s.extraShot) s.turn = target;
    return { state: s, info: { c: move.c, hit: !!ship, sunk, again: !!ship && s.extraShot && !allSunk } };
  },

  result: (state) => state.over,

  // Your own fleet + incoming shots; for the opponent only your shots and sunk ships.
  view(state, seat) {
    const sunkOf = (s) => (state.ships[s] ?? [])
      .map((sh, i) => (sh.hits === sh.cells.length ? { name: FLEET[i].name, cells: sh.cells } : null))
      .filter(Boolean);
    const boards = [0, 1].map((s) => ({
      shots: state.shots[s],
      ships: s === seat || state.over ? (state.ships[s] ?? []).map((sh) => ({ x: sh.x, y: sh.y, dir: sh.dir, cells: sh.cells })) : null,
      sunk: sunkOf(s),
      placed: !!state.ships[s],
      afloat: (state.ships[s] ?? []).filter((sh) => sh.hits < sh.cells.length).length,
    }));
    return { phase: state.phase, turn: state.turn, touching: state.touching, extraShot: state.extraShot, boards };
  },
};

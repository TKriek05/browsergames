// Schaken: full rules on top of shared/chess/position.js. The state is a FEN
// string plus the move list and a repetition counter, so it stays JSON-safe.
// Pure rules module (interface: see shared/rules/tictactoe.js).
// Wire format of a move: { from: 'e2', to: 'e4', promo?: 'q' | 'r' | 'b' | 'n' }.
import {
  Position, START_FEN, moveFrom, moveTo, movePromo, moveFlags, sqName, toSan,
  F_CAPTURE, F_CASTLE, F_EP, PAWN,
} from '../chess/position.js';

const PROMO_CHARS = ['', '', 'n', 'b', 'r', 'q'];

export function toWire(m) {
  const w = { from: sqName(moveFrom(m)), to: sqName(moveTo(m)) };
  const promo = movePromo(m);
  if (promo) w.promo = PROMO_CHARS[promo];
  return w;
}

function findMove(pos, wire) {
  for (const m of pos.legalMoves()) {
    const w = toWire(m);
    if (w.from === wire.from && w.to === wire.to && (w.promo ?? null) === (wire.promo ?? null)) return m;
  }
  return 0;
}

export default {
  id: 'chess',
  undo: true,

  setup() {
    const pos = new Position(START_FEN);
    return { fen: START_FEN, moves: [], seen: { [pos.key()]: 1 }, check: false, over: null };
  },

  toMove(state) {
    if (state.over) return [];
    return [state.fen.split(' ')[1] === 'w' ? 0 : 1];
  },

  legalMoves(state, seat) {
    if (state.over || this.toMove(state)[0] !== seat) return [];
    return new Position(state.fen).legalMoves().map(toWire);
  },

  isLegal(state, seat, move) {
    if (this.toMove(state)[0] !== seat) return false;
    return !!findMove(new Position(state.fen), move);
  },

  apply(state, seat, move) {
    const pos = new Position(state.fen);
    const legal = pos.legalMoves();
    const m = findMove(pos, move);
    const san = toSan(pos, m, legal);
    const flags = moveFlags(m);
    const captured = flags & F_EP ? PAWN : Math.abs(pos.board[moveTo(m)]);
    pos.make(m);

    const key = pos.key();
    const seen = pos.halfmove === 0 ? {} : { ...state.seen }; // irreversible move: old positions cannot return
    seen[key] = (seen[key] ?? 0) + 1;
    const check = pos.inCheck();
    const replies = pos.legalMoves().length;
    let over = null;
    if (!replies) {
      over = check
        ? { winners: [seat], draw: false, reason: 'Schaakmat' }
        : { winners: [], draw: true, reason: 'Pat' };
    } else if (pos.halfmove >= 100) over = { winners: [], draw: true, reason: '50 zetten zonder slag of pionzet' };
    else if (seen[key] >= 3) over = { winners: [], draw: true, reason: 'Drie keer dezelfde stelling' };
    else if (pos.insufficientMaterial()) over = { winners: [], draw: true, reason: 'Te weinig materiaal om mat te zetten' };

    return {
      state: { fen: pos.fen(), moves: [...state.moves, san], seen, check, over },
      info: {
        ...toWire(m),
        san,
        capture: flags & F_CAPTURE ? captured : 0,
        castle: flags & F_CASTLE ? (moveTo(m) > moveFrom(m) ? 'K' : 'Q') : null,
        ep: !!(flags & F_EP),
        check,
      },
    };
  },

  result: (state) => state.over,
  view: (state) => ({ fen: state.fen, moves: state.moves, check: state.check }),
};

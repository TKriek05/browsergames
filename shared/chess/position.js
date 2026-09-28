// Chess position on a 0x88 board with fast make/unmake. Pure JS, used by the
// rules module (client + server), the perft tests and the engine.
//
// Board: index = rank * 16 + file (rank 0 = white's first rank), off-board
// when (sq & 0x88) !== 0. Pieces: + white, - black; 1 P, 2 N, 3 B, 4 R, 5 Q, 6 K.
// Moves are integers: from | to << 7 | promo << 14 | flags << 17.

export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export const WHITE = 0, BLACK = 1;
export const F_CAPTURE = 1, F_DOUBLE = 2, F_EP = 4, F_CASTLE = 8, F_PROMO = 16;

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const KNIGHT_D = [33, 31, 18, 14, -33, -31, -18, -14];
const KING_D = [16, -16, 1, -1, 17, 15, -17, -15];
const BISHOP_D = [17, 15, -17, -15];
const ROOK_D = [16, -16, 1, -1];
const PIECE_CHARS = ' pnbrqk';

// Castling rights: 1 white O-O, 2 white O-O-O, 4 black O-O, 8 black O-O-O.
const CASTLE_MASK = new Uint8Array(128).fill(15);
CASTLE_MASK[0x00] = 15 & ~2; // a1
CASTLE_MASK[0x07] = 15 & ~1; // h1
CASTLE_MASK[0x04] = 15 & ~3; // e1
CASTLE_MASK[0x70] = 15 & ~8; // a8
CASTLE_MASK[0x77] = 15 & ~4; // h8
CASTLE_MASK[0x74] = 15 & ~12; // e8

export const moveFrom = (m) => m & 0x7f;
export const moveTo = (m) => (m >> 7) & 0x7f;
export const movePromo = (m) => (m >> 14) & 7;
export const moveFlags = (m) => m >> 17;
const encode = (from, to, promo, flags) => from | (to << 7) | (promo << 14) | (flags << 17);

export const sqName = (sq) => 'abcdefgh'[sq & 7] + (1 + (sq >> 4));
export function sqFromName(name) {
  if (typeof name !== 'string' || !/^[a-h][1-8]$/.test(name)) return -1;
  return (name.charCodeAt(1) - 49) * 16 + (name.charCodeAt(0) - 97);
}

export class Position {
  constructor(fen = START_FEN) {
    this.board = new Int8Array(128);
    this.kings = [0, 0];
    this.history = [];
    this.load(fen);
  }

  load(fen) {
    const [placement, side, castling, ep, half, full] = fen.trim().split(/\s+/);
    this.board.fill(0);
    let rank = 7;
    let file = 0;
    for (const ch of placement) {
      if (ch === '/') { rank--; file = 0; continue; }
      if (ch >= '1' && ch <= '8') { file += Number(ch); continue; }
      const type = PIECE_CHARS.indexOf(ch.toLowerCase());
      if (type < 1) throw new Error(`bad FEN piece ${ch}`);
      const sq = rank * 16 + file;
      this.board[sq] = ch === ch.toUpperCase() ? type : -type;
      if (type === KING) this.kings[ch === ch.toUpperCase() ? WHITE : BLACK] = sq;
      file++;
    }
    this.side = side === 'b' ? BLACK : WHITE;
    this.castling = 0;
    if (castling && castling !== '-') {
      if (castling.includes('K')) this.castling |= 1;
      if (castling.includes('Q')) this.castling |= 2;
      if (castling.includes('k')) this.castling |= 4;
      if (castling.includes('q')) this.castling |= 8;
    }
    this.ep = ep && ep !== '-' ? sqFromName(ep) : -1;
    this.halfmove = Number(half ?? 0) || 0;
    this.fullmove = Number(full ?? 1) || 1;
    this.history.length = 0;
    return this;
  }

  // Position part of the FEN (no clocks): used for repetition.
  key() {
    return this.fen().split(' ').slice(0, 4).join(' ');
  }

  fen() {
    let out = '';
    for (let rank = 7; rank >= 0; rank--) {
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const p = this.board[rank * 16 + file];
        if (!p) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        const ch = PIECE_CHARS[Math.abs(p)];
        out += p > 0 ? ch.toUpperCase() : ch;
      }
      if (empty) out += empty;
      if (rank) out += '/';
    }
    let c = '';
    if (this.castling & 1) c += 'K';
    if (this.castling & 2) c += 'Q';
    if (this.castling & 4) c += 'k';
    if (this.castling & 8) c += 'q';
    return `${out} ${this.side === WHITE ? 'w' : 'b'} ${c || '-'} ${this.ep >= 0 ? sqName(this.ep) : '-'} ${this.halfmove} ${this.fullmove}`;
  }

  // Is `sq` attacked by `by` (WHITE/BLACK)?
  attacked(sq, by) {
    const b = this.board;
    const sign = by === WHITE ? 1 : -1;
    // Pawns attack diagonally forward: look backwards from sq.
    const back = by === WHITE ? -16 : 16;
    for (const d of [back - 1, back + 1]) {
      const s = sq + d;
      if (!(s & 0x88) && b[s] === sign * PAWN) return true;
    }
    for (const d of KNIGHT_D) {
      const s = sq + d;
      if (!(s & 0x88) && b[s] === sign * KNIGHT) return true;
    }
    for (const d of KING_D) {
      const s = sq + d;
      if (!(s & 0x88) && b[s] === sign * KING) return true;
    }
    for (const d of BISHOP_D) {
      for (let s = sq + d; !(s & 0x88); s += d) {
        const p = b[s];
        if (!p) continue;
        if (p === sign * BISHOP || p === sign * QUEEN) return true;
        break;
      }
    }
    for (const d of ROOK_D) {
      for (let s = sq + d; !(s & 0x88); s += d) {
        const p = b[s];
        if (!p) continue;
        if (p === sign * ROOK || p === sign * QUEEN) return true;
        break;
      }
    }
    return false;
  }

  inCheck(side = this.side) {
    return this.attacked(this.kings[side], 1 - side);
  }

  // Pseudo-legal moves (may leave the king in check).
  pseudoMoves(out = [], capturesOnly = false) {
    const b = this.board;
    const us = this.side;
    const sign = us === WHITE ? 1 : -1;
    const fwd = us === WHITE ? 16 : -16;
    const startRank = us === WHITE ? 1 : 6;
    const promoRank = us === WHITE ? 7 : 0;

    for (let from = 0; from < 128; from++) {
      if (from & 0x88) { from += 7; continue; }
      const p = b[from] * sign;
      if (p <= 0) continue;

      if (p === PAWN) {
        const one = from + fwd;
        if (!capturesOnly && !(one & 0x88) && !b[one]) {
          if (one >> 4 === promoRank) for (let pr = QUEEN; pr >= KNIGHT; pr--) out.push(encode(from, one, pr, F_PROMO));
          else {
            out.push(encode(from, one, 0, 0));
            const two = one + fwd;
            if (from >> 4 === startRank && !b[two]) out.push(encode(from, two, 0, F_DOUBLE));
          }
        } else if (capturesOnly && !(one & 0x88) && !b[one] && one >> 4 === promoRank) {
          out.push(encode(from, one, QUEEN, F_PROMO)); // queen promotions matter in quiescence
        }
        for (const d of [fwd - 1, fwd + 1]) {
          const to = from + d;
          if (to & 0x88) continue;
          if (b[to] * sign < 0) {
            if (to >> 4 === promoRank) for (let pr = QUEEN; pr >= KNIGHT; pr--) out.push(encode(from, to, pr, F_PROMO | F_CAPTURE));
            else out.push(encode(from, to, 0, F_CAPTURE));
          } else if (to === this.ep) out.push(encode(from, to, 0, F_EP | F_CAPTURE));
        }
        continue;
      }

      if (p === KNIGHT || p === KING) {
        for (const d of p === KNIGHT ? KNIGHT_D : KING_D) {
          const to = from + d;
          if (to & 0x88) continue;
          const t = b[to] * sign;
          if (t > 0) continue;
          if (t < 0) out.push(encode(from, to, 0, F_CAPTURE));
          else if (!capturesOnly) out.push(encode(from, to, 0, 0));
        }
        if (p === KING && !capturesOnly) this._castles(from, out);
        continue;
      }

      const dirs = p === BISHOP ? BISHOP_D : p === ROOK ? ROOK_D : KING_D;
      for (const d of dirs) {
        for (let to = from + d; !(to & 0x88); to += d) {
          const t = b[to] * sign;
          if (t > 0) break;
          if (t < 0) { out.push(encode(from, to, 0, F_CAPTURE)); break; }
          if (!capturesOnly) out.push(encode(from, to, 0, 0));
        }
      }
    }
    return out;
  }

  _castles(from, out) {
    const b = this.board;
    const us = this.side;
    const them = 1 - us;
    const home = us === WHITE ? 0x04 : 0x74;
    if (from !== home) return;
    const kRight = us === WHITE ? 1 : 4;
    const qRight = us === WHITE ? 2 : 8;
    if ((this.castling & kRight) && !b[home + 1] && !b[home + 2] &&
        !this.attacked(home, them) && !this.attacked(home + 1, them) && !this.attacked(home + 2, them)) {
      out.push(encode(home, home + 2, 0, F_CASTLE));
    }
    if ((this.castling & qRight) && !b[home - 1] && !b[home - 2] && !b[home - 3] &&
        !this.attacked(home, them) && !this.attacked(home - 1, them) && !this.attacked(home - 2, them)) {
      out.push(encode(home, home - 2, 0, F_CASTLE));
    }
  }

  make(m) {
    const b = this.board;
    const from = moveFrom(m);
    const to = moveTo(m);
    const flags = moveFlags(m);
    const piece = b[from];
    const us = this.side;
    let captured = b[to];
    let capSq = to;
    if (flags & F_EP) {
      capSq = to + (us === WHITE ? -16 : 16);
      captured = b[capSq];
      b[capSq] = 0;
    }
    this.history.push({ m, captured, capSq, castling: this.castling, ep: this.ep, halfmove: this.halfmove });

    b[to] = flags & F_PROMO ? (us === WHITE ? movePromo(m) : -movePromo(m)) : piece;
    b[from] = 0;
    if (Math.abs(piece) === KING) {
      this.kings[us] = to;
      if (flags & F_CASTLE) {
        // Move the rook too.
        if (to > from) { b[from + 1] = b[from + 3]; b[from + 3] = 0; }
        else { b[from - 1] = b[from - 4]; b[from - 4] = 0; }
      }
    }
    this.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
    this.ep = flags & F_DOUBLE ? from + (us === WHITE ? 16 : -16) : -1;
    this.halfmove = Math.abs(piece) === PAWN || captured ? 0 : this.halfmove + 1;
    if (us === BLACK) this.fullmove++;
    this.side = 1 - us;
  }

  unmake() {
    const h = this.history.pop();
    const b = this.board;
    const m = h.m;
    const from = moveFrom(m);
    const to = moveTo(m);
    const flags = moveFlags(m);
    this.side = 1 - this.side;
    const us = this.side;
    if (us === BLACK) this.fullmove--;
    const moved = flags & F_PROMO ? (us === WHITE ? PAWN : -PAWN) : b[to];
    b[from] = moved;
    b[to] = 0;
    if (h.captured) b[h.capSq] = h.captured;
    if (Math.abs(moved) === KING) {
      this.kings[us] = from;
      if (flags & F_CASTLE) {
        if (to > from) { b[from + 3] = b[from + 1]; b[from + 1] = 0; }
        else { b[from - 4] = b[from - 1]; b[from - 1] = 0; }
      }
    }
    this.castling = h.castling;
    this.ep = h.ep;
    this.halfmove = h.halfmove;
  }

  legalMoves() {
    const out = [];
    for (const m of this.pseudoMoves()) {
      this.make(m);
      if (!this.inCheck(1 - this.side)) out.push(m);
      this.unmake();
    }
    return out;
  }

  perft(depth) {
    if (depth === 0) return 1;
    let nodes = 0;
    for (const m of this.pseudoMoves()) {
      this.make(m);
      if (!this.inCheck(1 - this.side)) nodes += depth === 1 ? 1 : this.perft(depth - 1);
      this.unmake();
    }
    return nodes;
  }

  // Not enough material for anyone to mate.
  insufficientMaterial() {
    const minors = [];
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const t = Math.abs(this.board[sq]);
      if (!t || t === KING) continue;
      if (t === PAWN || t === ROOK || t === QUEEN) return false;
      minors.push({ t, color: ((sq >> 4) + (sq & 7)) % 2 });
    }
    if (minors.length <= 1) return true;
    // Only bishops, all on the same colour.
    return minors.every((x) => x.t === BISHOP) && minors.every((x) => x.color === minors[0].color);
  }
}

// Standard notation with Dutch piece letters (K koning, D dame, T toren, L loper, P paard).
const NL = ['', '', 'P', 'L', 'T', 'D', 'K'];
export function toSan(pos, m, legal = pos.legalMoves()) {
  const from = moveFrom(m);
  const to = moveTo(m);
  const flags = moveFlags(m);
  const type = Math.abs(pos.board[from]);
  let san;
  if (flags & F_CASTLE) san = to > from ? 'O-O' : 'O-O-O';
  else {
    san = NL[type];
    if (type === PAWN) {
      if (flags & F_CAPTURE) san += 'abcdefgh'[from & 7];
    } else {
      // Disambiguate when another piece of the same type can reach `to`.
      const rivals = legal.filter((o) => o !== m && moveTo(o) === to && Math.abs(pos.board[moveFrom(o)]) === type);
      if (rivals.length) {
        const sameFile = rivals.some((o) => (moveFrom(o) & 7) === (from & 7));
        const sameRank = rivals.some((o) => moveFrom(o) >> 4 === from >> 4);
        if (!sameFile) san += 'abcdefgh'[from & 7];
        else if (!sameRank) san += 1 + (from >> 4);
        else san += sqName(from);
      }
    }
    if (flags & F_CAPTURE) san += 'x';
    san += sqName(to);
    if (flags & F_PROMO) san += `=${NL[movePromo(m)]}`;
  }
  pos.make(m);
  if (pos.inCheck()) san += pos.legalMoves().length ? '+' : '#';
  pos.unmake();
  return san;
}

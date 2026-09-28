// Pesten: the Dutch card game for 2-6 players (52 cards + 2 jokers).
// Play a card of the same suit or rank; first one without cards wins.
// Bully cards ("pestkaarten"):
//   2      next player draws 2 (or stacks a 2 or a joker)
//   joker  next player draws 5 (stackable); afterwards anything may be played
//   7      "zeven blijft kleven": play again
//   8      "wacht": the next player skips a turn
//   ace    reverse the direction (with 2 players: play again)
//   jack   "boer": may go on anything, you pick the next suit
// No card to play? Draw one; if it fits you may still play it.
// Pure rules module (interface: see shared/rules/tictactoe.js).

export const SUITS = ['harten', 'ruiten', 'klaveren', 'schoppen'];
export const JOKERS = [52, 53];
export const MAX_MOVES = 600; // safety net: the game ends even if everyone keeps passing

export const isJoker = (c) => c >= 52;
export const suitOf = (c) => (c >= 52 ? -1 : Math.floor(c / 13));
export const rankOf = (c) => (c >= 52 ? 0 : (c % 13) + 1); // 1 = aas … 11 boer, 12 vrouw, 13 heer

const RANK_NAMES = ['joker', 'aas', 'twee', 'drie', 'vier', 'vijf', 'zes', 'zeven', 'acht', 'negen', 'tien', 'boer', 'vrouw', 'heer'];
export function cardName(c) {
  if (isJoker(c)) return 'joker';
  return `${SUITS[suitOf(c)]} ${RANK_NAMES[rankOf(c)]}`;
}

// Penalty points of cards left in a hand (for the ranking of the losers).
export function cardPoints(c) {
  if (isJoker(c)) return 50;
  const r = rankOf(c);
  if (r === 2 || r === 11) return 20;
  if (r === 1 || r === 7 || r === 8) return 15;
  return r > 10 ? 10 : r;
}

function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

const sortHand = (hand) => hand.sort((a, b) => (suitOf(a) === suitOf(b) ? rankOf(a) - rankOf(b) : (isJoker(a) ? 9 : suitOf(a)) - (isJoker(b) ? 9 : suitOf(b))));
const isBully = (c) => isJoker(c) || [1, 2, 7, 8, 11].includes(rankOf(c));

export function canPlay(state, card) {
  const top = state.pile[state.pile.length - 1];
  if (state.pending > 0) return isJoker(card) || rankOf(card) === 2;
  if (isJoker(card) || rankOf(card) === 11) return true;
  if (state.suit < 0) return true; // after a joker anything goes
  return suitOf(card) === state.suit || (!isJoker(top) && rankOf(card) === rankOf(top));
}

function refill(s, rng) {
  if (s.deck.length || s.pile.length < 2) return;
  const top = s.pile.pop();
  s.deck = shuffle(s.pile, rng);
  s.pile = [top];
}

function drawCards(s, seat, n, rng) {
  const got = [];
  for (let i = 0; i < n; i++) {
    refill(s, rng);
    if (!s.deck.length) break;
    got.push(s.deck.pop());
  }
  s.hands[seat] = sortHand([...s.hands[seat], ...got]);
  return got;
}

const step = (s, k) => ((s.turn + s.dir * k) % s.n + s.n) % s.n;

function advance(s, k = 1) {
  s.turn = step(s, k);
  s.drew = false;
}

// Losers are ranked by fewest cards, then fewest penalty points.
function ranking(s, winner) {
  const others = [...Array(s.n).keys()].filter((x) => x !== winner);
  const pts = (x) => s.hands[x].reduce((sum, c) => sum + cardPoints(c), 0);
  others.sort((a, b) => s.hands[a].length - s.hands[b].length || pts(a) - pts(b));
  return winner === null ? others : [winner, ...others];
}

export default {
  id: 'pesten',
  undo: false,
  rankingScore: true,

  setup({ seats, settings = {}, rng }) {
    const handSize = settings.hand === 5 ? 5 : 7;
    const cards = [...Array(52).keys()];
    if (settings.jokers !== false) cards.push(...JOKERS);
    const deck = shuffle(cards, rng);
    const hands = [];
    for (let i = 0; i < seats; i++) hands.push(sortHand(deck.splice(deck.length - handSize, handSize)));
    // The first open card is a plain one (bully cards go back under the deck).
    let first = deck.pop();
    while (isBully(first)) {
      deck.unshift(first);
      first = deck.pop();
    }
    return {
      n: seats, hands, deck, pile: [first], suit: suitOf(first), dir: 1, turn: 0,
      pending: 0, drew: false, moves: 0, over: null,
    };
  },

  toMove(state) {
    return state.over ? [] : [state.turn];
  },

  legalMoves(state, seat) {
    if (state.over || seat !== state.turn) return [];
    const moves = [];
    for (const card of new Set(state.hands[seat])) {
      if (!canPlay(state, card)) continue;
      if (rankOf(card) === 11 && !isJoker(card)) for (let suit = 0; suit < 4; suit++) moves.push({ type: 'play', card, suit });
      else moves.push({ type: 'play', card });
    }
    if (state.pending > 0 || !state.drew) moves.push({ type: 'draw' });
    else moves.push({ type: 'pass' });
    return moves;
  },

  apply(state, seat, move, rng) {
    const s = { ...state, hands: state.hands.map((h) => h.slice()), deck: state.deck.slice(), pile: state.pile.slice() };
    s.moves++;
    let info;
    if (move.type === 'play') {
      const card = move.card;
      s.hands[seat].splice(s.hands[seat].indexOf(card), 1);
      s.pile.push(card);
      const r = rankOf(card);
      s.suit = isJoker(card) ? -1 : r === 11 ? move.suit : suitOf(card);
      info = { type: 'play', card, suit: s.suit };
      if (!s.hands[seat].length) {
        s.over = { winners: [seat], draw: false, ranking: ranking(s, seat), reason: 'Alle kaarten zijn op' };
        return { state: s, info: { ...info, out: true } };
      }
      if (s.hands[seat].length === 1) info.last = true;
      if (isJoker(card)) {
        s.pending += 5;
        advance(s);
      } else if (r === 2) {
        s.pending += 2;
        advance(s);
      } else if (r === 7) {
        s.drew = false; // zeven blijft kleven
        info.again = true;
      } else if (r === 8) {
        info.skip = step(s, 1);
        advance(s, 2);
      } else if (r === 1) {
        if (s.n === 2) {
          s.drew = false;
          info.again = true;
        } else {
          s.dir = -s.dir;
          advance(s);
        }
        info.reverse = true;
      } else advance(s);
    } else if (move.type === 'draw') {
      if (s.pending > 0) {
        const got = drawCards(s, seat, s.pending, rng);
        info = { type: 'draw', n: got.length, penalty: true };
        s.pending = 0;
        advance(s);
      } else {
        const got = drawCards(s, seat, 1, rng);
        info = { type: 'draw', n: got.length };
        s.drew = true;
        // Nothing to do with it? Then the turn passes by itself.
        if (!got.length || !canPlay(s, got[0])) {
          info.pass = true;
          advance(s);
        }
      }
    } else {
      info = { type: 'pass' };
      advance(s);
    }
    if (!s.over && s.moves >= MAX_MOVES) {
      const order = ranking(s, null);
      s.over = { winners: [order[0]], draw: false, ranking: order, reason: 'Het duurde te lang: de minste kaarten wint' };
    }
    return { state: s, info };
  },

  result: (state) => state.over,

  // Your own hand; for the others only how many cards they hold (all hands at the end).
  view(state, seat) {
    return {
      n: state.n,
      hand: seat >= 0 ? state.hands[seat] : null,
      counts: state.hands.map((h) => h.length),
      pile: state.pile.slice(-4),
      suit: state.suit,
      dir: state.dir,
      turn: state.turn,
      pending: state.pending,
      drew: state.drew,
      deck: state.deck.length,
      hands: state.over ? state.hands : null,
    };
  },
};

// Pesten on a green card table: your hand fanned at the bottom (playable
// cards lift up), the other players' hands along the top, the draw pile and
// the discard pile in the middle with the asked suit, the stack of cards to
// draw and the playing direction.
import { createBoardModule } from '../board/kit.js';
import { h } from '../../js/core/ui.js';
import { feltTable, roundRect, easeOutCubic } from '../board/draw.js';
import { SUITS, rankOf, isJoker, cardName } from '../../../shared/rules/pesten.js';
import { drawCard, drawBack, drawSuit } from './cards.js';

const W = 900;
const H = 600;
const CW = 76;
const CH = 106;
const DECK = { x: W / 2 - CW - 18, y: 236 };
const PILE = { x: W / 2 + 18, y: 236 };
const HAND_Y = H - CH - 26;
const SUIT_BTN = 30;
const SUIT_NAMES = ['Harten', 'Ruiten', 'Klaveren', 'Schoppen'];

// Layout of the current frame (keyboard cursor + hit tests use it).
const lay = { hand: [], xs: [], step: 0, jack: false, suitXs: [] };

const seatOrder = (f) => {
  const n = f.view.n;
  const me = f.you >= 0 ? f.you : 0;
  return Array.from({ length: n - 1 }, (_, k) => (me + 1 + k) % n);
};

function opponentAnchor(f, seat) {
  const others = seatOrder(f);
  const i = others.indexOf(seat);
  const span = W - 160;
  const x = others.length === 1 ? W / 2 : 80 + (span * i) / (others.length - 1);
  return { x, y: 74 };
}

function anchorOf(f, seat) {
  const me = f.you >= 0 ? f.you : 0;
  if (seat === me) return { x: W / 2 - CW / 2, y: HAND_Y };
  const a = opponentAnchor(f, seat);
  return { x: a.x - CW / 2, y: a.y - 20 };
}

function playable(f, card) {
  return f.myTurn && f.legal.some((m) => m.type === 'play' && m.card === card);
}

function handLayout(f) {
  const hand = f.view.hand ?? [];
  lay.hand = hand;
  const n = hand.length;
  const maxW = W - 120;
  lay.step = n > 1 ? Math.min(CW + 8, (maxW - CW) / (n - 1)) : 0;
  const total = CW + lay.step * Math.max(0, n - 1);
  const x0 = (W - total) / 2;
  lay.xs = hand.map((_, i) => x0 + i * lay.step);
  lay.jack = f.local.jack !== null && f.local.jack !== undefined;
  lay.suitXs = [0, 1, 2, 3].map((s) => W / 2 + (s - 1.5) * (SUIT_BTN * 2 + 14));
}

function drawOpponent(ctx, f, seat) {
  const v = f.view;
  const a = opponentAnchor(f, seat);
  const count = v.counts[seat];
  const turn = v.turn === seat && !f.snap.result;
  const shown = Math.min(count, 9);
  const cw = 38;
  const ch = 53;
  const spread = Math.min(12, 90 / Math.max(1, shown));
  const x0 = a.x - (cw + spread * (shown - 1)) / 2;
  const open = v.hands?.[seat];
  for (let i = 0; i < shown; i++) {
    const x = x0 + i * spread;
    const y = a.y - 26 + Math.abs(i - (shown - 1) / 2) * 1.2;
    if (open) drawCard(ctx, open[i], x, y, cw, ch);
    else drawBack(ctx, x, y, cw, ch);
  }
  // Name plate.
  const name = f.nameOf(seat);
  ctx.font = '700 14px system-ui, sans-serif';
  const tw = Math.max(90, ctx.measureText(name).width + 34);
  roundRect(ctx, a.x - tw / 2, a.y + 34, tw, 24, 12);
  ctx.fillStyle = turn ? '#fff4c2' : 'rgba(12, 32, 22, 0.72)';
  ctx.fill();
  if (turn) {
    ctx.strokeStyle = '#ffd23e';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(a.x - tw / 2 + 13, a.y + 46, 5, 0, Math.PI * 2);
  ctx.fillStyle = f.colorOf(seat);
  ctx.fill();
  ctx.fillStyle = turn ? '#2a2210' : '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, a.x - tw / 2 + 24, a.y + 46.5);
  ctx.textAlign = 'center';
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.fillStyle = count === 1 ? '#ffd23e' : 'rgba(255,255,255,0.85)';
  ctx.fillText(count === 1 ? 'Laatste kaart!' : `${count} kaarten`, a.x, a.y + 70);
}

function drawCenter(ctx, f) {
  const v = f.view;
  // Draw pile (a little stack).
  const layers = Math.min(5, Math.ceil(v.deck / 8));
  for (let i = layers; i >= 0; i--) drawBack(ctx, DECK.x - i * 1.2, DECK.y - i * 1.2, CW, CH);
  const canDraw = f.myTurn && f.legal.some((m) => m.type === 'draw');
  if (canDraw && (f.hover === 'deck' || f.cursor?.col === lay.hand.length)) {
    roundRect(ctx, DECK.x - 5, DECK.y - 5, CW + 10, CH + 10, 10);
    ctx.strokeStyle = '#ffe14d';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`${v.deck} op de stapel`, DECK.x + CW / 2, DECK.y + CH + 10);

  // Discard pile: the cards underneath a bit rotated, the newest flies in.
  const pile = v.pile;
  const flying = f.last?.info?.type === 'play' && f.anim < 1;
  const under = flying ? pile.slice(0, -1) : pile;
  under.forEach((c, i) => {
    ctx.save();
    ctx.translate(PILE.x + CW / 2, PILE.y + CH / 2);
    ctx.rotate(((c * 37) % 13 - 6) * 0.018 * (i + 1 < under.length ? 1 : 0.4));
    drawCard(ctx, c, -CW / 2, -CH / 2, CW, CH);
    ctx.restore();
  });
  if (flying) {
    const from = anchorOf(f, f.last.seat);
    const t = easeOutCubic(f.anim);
    drawCard(ctx, pile[pile.length - 1], from.x + (PILE.x - from.x) * t, from.y + (PILE.y - from.y) * t, CW, CH);
  }

  // Asked suit (after a jack) or "anything goes" (after a joker).
  const top = pile[pile.length - 1];
  const bx = PILE.x + CW + 56;
  const by = PILE.y + CH / 2;
  if (v.suit < 0 || rankOf(top) === 11) {
    ctx.beginPath();
    ctx.arc(bx, by, 26, 0, Math.PI * 2);
    ctx.fillStyle = '#fdfbf5';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (v.suit >= 0) drawSuit(ctx, v.suit, bx, by, 26);
    else {
      ctx.fillStyle = '#7a3fc0';
      ctx.font = '800 13px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText('ALLES', bx, by);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(v.suit >= 0 ? 'gevraagd' : 'mag', bx, by + 32);
  }
  // Cards waiting to be drawn.
  if (v.pending > 0) {
    const px = PILE.x + CW / 2;
    const py = PILE.y - 18;
    roundRect(ctx, px - 34, py - 14, 68, 28, 14);
    ctx.fillStyle = '#d62839';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 17px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(`+${v.pending}`, px, py + 1);
  }
  // Direction: a ring of arrows around the middle.
  ctx.save();
  ctx.translate(W / 2, PILE.y + CH / 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 3;
  const r = 150;
  for (let k = 0; k < 4; k++) {
    const a0 = k * (Math.PI / 2) + 0.35 + f.time * 0.25 * v.dir;
    const a1 = a0 + 0.9;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.25, r * 0.55, 0, a0, a1);
    ctx.stroke();
    const end = v.dir > 0 ? a1 : a0;
    const ex = Math.cos(end) * r * 1.25;
    const ey = Math.sin(end) * r * 0.55;
    const tx = -Math.sin(end) * r * 1.25 * v.dir;
    const ty = Math.cos(end) * r * 0.55 * v.dir;
    const tl = Math.hypot(tx, ty) || 1;
    ctx.beginPath();
    ctx.moveTo(ex + (tx / tl) * 8, ey + (ty / tl) * 8);
    ctx.lineTo(ex - (ty / tl) * 6, ey + (tx / tl) * 6);
    ctx.lineTo(ex + (ty / tl) * 6, ey - (tx / tl) * 6);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fill();
  }
  ctx.restore();
}

function drawHand(ctx, f) {
  const v = f.view;
  if (f.spectator) {
    const count = v.counts[0];
    const x0 = W / 2 - (CW + Math.min(20, 400 / count) * (count - 1)) / 2;
    for (let i = 0; i < count; i++) drawBack(ctx, x0 + i * Math.min(20, 400 / count), HAND_Y + 10, CW, CH);
    return;
  }
  const hovered = f.cursor ? f.cursor.col : typeof f.hover === 'object' && f.hover ? f.hover.hand : -1;
  lay.hand.forEach((card, i) => {
    const can = playable(f, card);
    const lift = (can ? 14 : 0) + (i === hovered && can ? 10 : 0) + (f.local.jack === card ? 24 : 0);
    drawCard(ctx, card, lay.xs[i], HAND_Y - lift, CW, CH, {
      glow: i === hovered ? '#ffe14d' : can ? 'rgba(255, 225, 77, 0.55)' : null,
      dim: f.myTurn && !can,
    });
  });
  if (lay.jack) {
    ctx.fillStyle = 'rgba(10, 30, 20, 0.8)';
    roundRect(ctx, W / 2 - 170, HAND_Y - 118, 340, 86, 16);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Welke kleur vraag je?', W / 2, HAND_Y - 110);
    lay.suitXs.forEach((x, s) => {
      const on = f.cursor ? f.cursor.col === s : f.hover?.suit === s;
      ctx.beginPath();
      ctx.arc(x, HAND_Y - 62, SUIT_BTN - 6, 0, Math.PI * 2);
      ctx.fillStyle = on ? '#fff4c2' : '#fdfbf5';
      ctx.fill();
      if (on) {
        ctx.strokeStyle = '#ffd23e';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      drawSuit(ctx, s, x, HAND_Y - 62, 26);
    });
  }
}

export const { meta, createGame } = createBoardModule({
  id: 'pesten',
  width: W,
  height: H,

  seatLabel: (seat, f) => `${f.view.counts[seat]} ${f.view.counts[seat] === 1 ? 'kaart' : 'kaarten'}`,
  initLocal: () => ({ jack: null }),
  onReset: (local) => { local.jack = null; },
  onChange: (local) => { local.jack = null; },

  cursor: {
    get cols() { return lay.jack ? 4 : lay.hand.length + 1; },
    rows: 1,
    target: (col) => (lay.jack ? { suit: col } : col < lay.hand.length ? { hand: col } : 'deck'),
  },

  pick(x, y, f) {
    handLayout(f);
    if (lay.jack) {
      for (let s = 0; s < 4; s++) if (Math.hypot(x - lay.suitXs[s], y - (HAND_Y - 62)) < SUIT_BTN) return { suit: s };
    }
    if (!f.spectator) {
      for (let i = lay.hand.length - 1; i >= 0; i--) {
        const lift = playable(f, lay.hand[i]) ? 24 : 0;
        const w = i === lay.hand.length - 1 ? CW : lay.step;
        if (x >= lay.xs[i] && x <= lay.xs[i] + w && y >= HAND_Y - lift && y <= HAND_Y + CH) return { hand: i };
      }
    }
    if (x >= DECK.x - 6 && x <= DECK.x + CW && y >= DECK.y - 6 && y <= DECK.y + CH) return 'deck';
    return null;
  },

  onPick(target, api, f) {
    if (target === 'deck') {
      if (f.myTurn && f.legal.some((m) => m.type === 'draw')) api.move({ type: 'draw' });
      return;
    }
    if (target.suit !== undefined) {
      if (f.local.jack !== null) api.move({ type: 'play', card: f.local.jack, suit: target.suit });
      f.local.jack = null;
      api.refresh();
      return;
    }
    const card = lay.hand[target.hand];
    if (card === undefined || !playable(f, card)) {
      if (f.myTurn) api.sfx.play('error');
      return;
    }
    if (rankOf(card) === 11 && !isJoker(card)) {
      f.local.jack = f.local.jack === card ? null : card;
      api.refresh();
    } else api.move({ type: 'play', card });
  },

  onCancel(local) {
    local.jack = null;
  },

  describe(last, f) {
    const who = f.nameOf(last.seat);
    const i = last.info;
    if (i.type === 'play') {
      let text = `${who} speelt ${cardName(i.card)}.`;
      if (rankOf(i.card) === 11 && !isJoker(i.card)) text += ` Gevraagd: ${SUIT_NAMES[i.suit].toLowerCase()}.`;
      if (i.again) text += ' Nog een keer!';
      if (i.skip !== undefined) text += ` ${f.nameOf(i.skip)} moet wachten.`;
      if (i.reverse && !i.again) text += ' Andersom!';
      if (i.last) text += ' Laatste kaart!';
      return text;
    }
    if (i.type === 'draw') return `${who} pakt ${i.n} ${i.n === 1 ? 'kaart' : 'kaarten'}.`;
    return `${who} past.`;
  },
  animMs: (last) => (last.info.type === 'play' ? 320 : 150),
  sound: (last) => {
    const i = last.info;
    if (i.type === 'draw') return i.penalty ? 'lose' : 'flap';
    if (i.type === 'pass') return 'click';
    if (isJoker(i.card) || rankOf(i.card) === 2) return 'laugh';
    if (rankOf(i.card) === 8) return 'thud';
    return i.last ? 'coin' : 'click';
  },
  turnText: (f) => {
    const v = f.view;
    if (v.pending > 0) return `Pak ${v.pending} kaarten, of leg een 2 of een joker!`;
    if (v.drew) return 'Speel de gepakte kaart, of pas.';
    return 'Jouw beurt: speel een kaart of pak er een.';
  },

  panel(el, f, api) {
    if (f.local.jack !== null) {
      el.append(h('p', { class: 'bp__ask' }, 'Welke kleur vraag je?'),
        h('div', { class: 'bp__row' }, ...SUITS.map((_, s) => h('button', {
          class: 'btn btn--small', type: 'button', 'data-key': `suit-${s}`,
          onclick: () => {
            api.move({ type: 'play', card: f.local.jack, suit: s });
            f.local.jack = null;
          },
        }, SUIT_NAMES[s]))));
    }
    if (!f.myTurn) return;
    const draw = f.legal.find((m) => m.type === 'draw');
    const pass = f.legal.find((m) => m.type === 'pass');
    if (draw) {
      el.append(h('button', { class: 'btn btn--primary', type: 'button', 'data-key': 'draw', onclick: () => api.move({ type: 'draw' }) },
        f.view.pending > 0 ? `Pak ${f.view.pending} kaarten` : 'Pak een kaart'));
    }
    if (pass) el.append(h('button', { class: 'btn', type: 'button', 'data-key': 'pass', onclick: () => api.move({ type: 'pass' }) }, 'Pas'));
  },

  draw(ctx, f) {
    feltTable(ctx, 0, 0, W, H, '#1f6a45');
    handLayout(f);
    for (const seat of seatOrder(f)) drawOpponent(ctx, f, seat);
    drawCenter(ctx, f);
    drawHand(ctx, f);
    // Whose turn (the bottom player).
    if (!f.snap.result && f.myTurn && !lay.jack) {
      ctx.fillStyle = '#ffe14d';
      ctx.font = '700 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(f.view.pending > 0 ? `Pak ${f.view.pending} of leg een 2 / joker` : 'Jij bent aan de beurt', W / 2, HAND_Y - 42);
    }
  },
});

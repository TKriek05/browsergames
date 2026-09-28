// Quizkoorts (client side): a TV quiz studio. The question on a gold-rimmed
// board, four answer tiles (click, tap or keys 1-4 / A-D), a countdown ring,
// the players with their scores at the bottom and a podium at the end.
// Screen readers get the question and the outcome through a live region.
import { PLAYER_COLORS } from '../../../shared/constants.js';
import { h } from '../../js/core/ui.js';
import { createSharpLayer } from '../../js/core/canvas.js';
import { drawText, roundRect } from '../../js/core/hudtext.js';

export const meta = { width: 960, height: 540, pixelated: false, step: 1 / 60, input: false, touchControls: false };

const W = 960;
const H = 540;
const GOLD = '#e8b84a';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const TILES = [
  { x: 90, y: 252 }, { x: 490, y: 252 },
  { x: 90, y: 340 }, { x: 490, y: 340 },
];
const TW = 380;
const TH = 74;
const LETTERS = ['A', 'B', 'C', 'D'];
const KEYS = { 1: 0, 2: 1, 3: 2, 4: 3, a: 0, b: 1, c: 2, d: 3 };

function drawStudio(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#16204a');
  g.addColorStop(0.72, '#0c1330');
  g.addColorStop(1, '#070b1c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Spotlights from the ceiling.
  for (const [x, tilt] of [[140, 0.25], [W - 140, -0.25], [W / 2, 0]]) {
    const cone = ctx.createLinearGradient(x, 0, x + tilt * 200, H);
    cone.addColorStop(0, 'rgba(255, 236, 190, 0.16)');
    cone.addColorStop(1, 'rgba(255, 236, 190, 0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(x - 18, 0);
    ctx.lineTo(x + 18, 0);
    ctx.lineTo(x + tilt * 420 + 170, H);
    ctx.lineTo(x + tilt * 420 - 170, H);
    ctx.closePath();
    ctx.fill();
  }
  // Glossy stage floor.
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(0, 430, W, H - 430);
  ctx.fillStyle = 'rgba(232, 184, 74, 0.35)';
  ctx.fillRect(0, 430, W, 2);
}

function wrap(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export function createGame() {
  let view, ctx, net, session, sfx, reduced, studio, live;
  let snap = null;
  let recvAt = 0;
  let hover = -1;
  let lastBeat = 0;
  let time = 0;
  const cleanups = [];

  const me = () => session.me;
  const player = (id) => session.room?.players.find((p) => p.id === id) ?? null;
  const colorOf = (id) => PLAYER_COLORS[player(id)?.color ?? 0].hex;
  const nameOf = (id) => player(id)?.name ?? '?';
  const left = () => (snap ? Math.max(0, snap.left - (performance.now() - recvAt) / 1000) : 0);
  const canAnswer = () => snap?.phase === 'ask' && snap.mine < 0 && snap.players.some((p) => p.id === me());

  function answer(a) {
    if (!canAnswer()) return;
    net.send('input', { data: { type: 'answer', a } });
    snap.mine = a; // shown right away; the server confirms with the next snapshot
    sfx.play('click');
  }

  function tileAt(x, y) {
    for (let i = 0; i < 4; i++) {
      const t = TILES[i];
      if (x >= t.x && x <= t.x + TW && y >= t.y && y <= t.y + TH) return i;
    }
    return -1;
  }

  function announce(text) {
    if (live) live.textContent = text;
  }

  // --- Drawing ------------------------------------------------------------------------
  function bulbs() {
    // A marquee of light bulbs around the question board.
    const n = 34;
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (i / (n - 1)) * Math.PI;
      const x = W / 2 + Math.cos(a) * 430;
      const y = 236 + Math.sin(a) * 190;
      const on = reduced ? 1 : 0.55 + 0.45 * Math.sin(time * 3 + i * 0.8);
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 214, 120, ${0.35 + on * 0.6})`;
      ctx.fill();
    }
  }

  function header() {
    if (snap.phase === 'ask' || snap.phase === 'reveal') {
      drawText(ctx, `VRAAG ${snap.q + 1} / ${snap.total}`, 40, 26, { color: GOLD, scale: 2 });
      const cat = snap.question?.category ?? '';
      ctx.font = `700 14px ${FONT}`;
      const cw = ctx.measureText(cat).width + 26;
      roundRect(ctx, 40, 52, cw, 24, 12);
      ctx.fillStyle = 'rgba(232, 184, 74, 0.18)';
      ctx.fill();
      drawText(ctx, cat, 40 + cw / 2, 57, { color: '#ffe7ad', scale: 1.5, align: 'center' });
    }
    if (snap.phase === 'ask') {
      // Countdown ring.
      const cx = W - 70;
      const cy = 56;
      const frac = left() / snap.duration;
      ctx.lineWidth = 7;
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.arc(cx, cy, 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = frac < 0.3 ? '#ff6b5a' : GOLD;
      ctx.beginPath();
      ctx.arc(cx, cy, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();
      drawText(ctx, String(Math.ceil(left())), cx, cy - 13, { color: '#ffffff', scale: 2.8, align: 'center' });
    }
  }

  function board() {
    const q = snap.question;
    roundRect(ctx, 90, 92, W - 180, 140, 18);
    const g = ctx.createLinearGradient(0, 92, 0, 232);
    g.addColorStop(0, '#22306a');
    g.addColorStop(1, '#141d48');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = GOLD;
    ctx.stroke();
    ctx.font = `700 26px ${FONT}`;
    const size = wrap(ctx, q.text, W - 260).length > 2 ? 22 : 26;
    ctx.font = `700 ${size}px ${FONT}`;
    const wrapped = wrap(ctx, q.text, W - 260);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lh = size * 1.25;
    wrapped.forEach((line, i) => ctx.fillText(line, W / 2, 162 + (i - (wrapped.length - 1) / 2) * lh));
  }

  function tiles() {
    const q = snap.question;
    const reveal = snap.correct >= 0;
    for (let i = 0; i < 4; i++) {
      const t = TILES[i];
      const mine = snap.mine === i;
      let fill = '#1b2a5e';
      let text = '#ffffff';
      let rim = 'rgba(232, 184, 74, 0.6)';
      if (reveal) {
        if (i === snap.correct) { fill = '#2e9b4a'; rim = '#9df0b0'; } else if (mine) { fill = '#b8392f'; rim = '#ffb0a8'; } else { fill = '#141d42'; text = 'rgba(255,255,255,0.45)'; }
      } else if (mine) {
        fill = GOLD;
        text = '#1a1406';
        rim = '#fff2c8';
      } else if (hover === i && canAnswer()) fill = '#2a3d80';
      roundRect(ctx, t.x, t.y, TW, TH, 37);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = rim;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(t.x + 37, t.y + TH / 2, 22, 0, Math.PI * 2);
      ctx.fillStyle = mine && !reveal ? '#1a1406' : GOLD;
      ctx.fill();
      drawText(ctx, LETTERS[i], t.x + 37, t.y + TH / 2 - 11, { color: mine && !reveal ? GOLD : '#1a1406', scale: 2.5, align: 'center' });
      ctx.font = `650 19px ${FONT}`;
      ctx.fillStyle = text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const lines = wrap(ctx, q.answers[i], TW - 110);
      lines.slice(0, 2).forEach((line, k) => ctx.fillText(line, t.x + 72, t.y + TH / 2 + (k - (Math.min(2, lines.length) - 1) / 2) * 21));
      if (reveal) {
        // Who picked this one.
        const pickers = snap.players.filter((p) => p.pick === i);
        pickers.forEach((p, k) => {
          const px = t.x + TW - 22 - k * 20;
          ctx.beginPath();
          ctx.arc(px, t.y + TH / 2, 9, 0, Math.PI * 2);
          ctx.fillStyle = colorOf(p.id);
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
        });
      }
    }
  }

  function scores() {
    const list = snap.players;
    const n = list.length;
    const w = Math.min(170, (W - 60) / Math.max(1, n) - 10);
    const x0 = W / 2 - (n * (w + 10) - 10) / 2;
    list.forEach((p, i) => {
      const x = x0 + i * (w + 10);
      const y = 446;
      const isMe = p.id === me();
      roundRect(ctx, x, y, w, 70, 12);
      ctx.fillStyle = isMe ? 'rgba(232, 184, 74, 0.22)' : 'rgba(255,255,255,0.07)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = colorOf(p.id);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + 16, y + 20, 6, 0, Math.PI * 2);
      ctx.fillStyle = colorOf(p.id);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 26, y + 6, w - 32, 26);
      ctx.clip();
      drawText(ctx, nameOf(p.id), x + 28, y + 12, { color: '#ffffff', scale: 1.5 });
      ctx.restore();
      drawText(ctx, String(p.score), x + 14, y + 38, { color: GOLD, scale: 2.4 });
      if (snap.phase === 'ask' && p.answered) drawText(ctx, '✓', x + w - 12, y + 40, { color: '#9df0b0', scale: 2.4, align: 'right' });
      if (snap.phase === 'reveal' && p.gain > 0) drawText(ctx, `+${p.gain}`, x + w - 10, y + 42, { color: '#9df0b0', scale: 1.8, align: 'right' });
      if (p.streak >= 3) drawText(ctx, `🔥${p.streak}`, x + w - 10, y + 12, { color: '#ffb36b', scale: 1.4, align: 'right' });
    });
  }

  function intro() {
    drawText(ctx, 'QUIZKOORTS', W / 2, 150, { color: GOLD, scale: 7, align: 'center', shadow: '#3a2600' });
    drawText(ctx, `${snap.total} vragen · ${snap.duration} seconden per vraag`, W / 2, 232, { color: '#ffffff', scale: 2, align: 'center' });
    drawText(ctx, 'Snel én goed = de meeste punten', W / 2, 262, { color: '#c9d2ff', scale: 1.7, align: 'center' });
    drawText(ctx, String(Math.max(1, Math.ceil(left()))), W / 2, 310, { color: '#ffffff', scale: 6, align: 'center' });
  }

  function podium() {
    const top = snap.players.slice(0, 3);
    const spots = [{ x: W / 2 - 60, hgt: 120 }, { x: W / 2 - 200, hgt: 84 }, { x: W / 2 + 80, hgt: 60 }];
    drawText(ctx, 'EINDSTAND', W / 2, 60, { color: GOLD, scale: 4, align: 'center', shadow: '#3a2600' });
    top.forEach((p, i) => {
      const s = spots[i];
      const y = 400 - s.hgt;
      roundRect(ctx, s.x, y, 120, s.hgt, 8);
      ctx.fillStyle = ['#e8b84a', '#c9ced8', '#c98a4b'][i];
      ctx.fill();
      drawText(ctx, String(i + 1), s.x + 60, y + 12, { color: '#1a1406', scale: 4, align: 'center' });
      ctx.beginPath();
      ctx.arc(s.x + 60, y - 34, 22, 0, Math.PI * 2);
      ctx.fillStyle = colorOf(p.id);
      ctx.fill();
      drawText(ctx, nameOf(p.id).slice(0, 12), s.x + 60, y - 88, { color: '#ffffff', scale: 1.8, align: 'center' });
      drawText(ctx, `${p.score}`, s.x + 60, y - 66, { color: GOLD, scale: 1.8, align: 'center' });
    });
    if (!reduced) {
      for (let i = 0; i < 60; i++) {
        const x = (i * 97 + time * 40 * (1 + (i % 3))) % W;
        const y = (i * 53 + time * 90 * (1 + (i % 4)) * 0.4) % 430;
        ctx.fillStyle = PLAYER_COLORS[i % PLAYER_COLORS.length].hex;
        ctx.fillRect(x, y, 5, 8);
      }
    }
  }

  return {
    mount(v, netRef, c) {
      view = v;
      ctx = v.ctx;
      net = netRef;
      session = c.session;
      sfx = c.sfx;
      reduced = c.reducedMotion;
      studio = createSharpLayer(view, drawStudio);
      const canvas = view.canvas;
      canvas.tabIndex = 0;
      canvas.setAttribute('role', 'application');
      canvas.setAttribute('aria-label', 'Quizkoorts: kies een antwoord met 1 t/m 4 of A t/m D');
      live = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
      canvas.parentElement?.append(live);
      const move = (e) => {
        const p = view.toLogical(e.clientX, e.clientY);
        hover = tileAt(p.x, p.y);
        canvas.style.cursor = hover >= 0 && canAnswer() ? 'pointer' : 'default';
      };
      const click = (e) => {
        const p = view.toLogical(e.clientX, e.clientY);
        const t = tileAt(p.x, p.y);
        if (t >= 0) answer(t);
      };
      const key = (e) => {
        if (e.target?.closest?.('input, textarea, select, dialog')) return;
        const a = KEYS[e.key?.toLowerCase()];
        if (a !== undefined) {
          answer(a);
          e.preventDefault();
        }
      };
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('click', click);
      window.addEventListener('keydown', key);
      cleanups.push(() => {
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('click', click);
        window.removeEventListener('keydown', key);
        live?.remove();
      });
    },

    onSnapshot(msg) {
      const prev = snap;
      snap = msg.state;
      recvAt = performance.now();
      // Keep a pick we just sent until the server has it.
      if (prev && prev.phase === 'ask' && snap.phase === 'ask' && prev.q === snap.q && snap.mine < 0 && prev.mine >= 0) snap.mine = prev.mine;
      if (snap.phase === 'ask' && (prev?.phase !== 'ask' || prev?.q !== snap.q)) {
        sfx.play('go');
        const q = snap.question;
        announce(`Vraag ${snap.q + 1}: ${q.text} ${q.answers.map((a, i) => `${LETTERS[i]}: ${a}.`).join(' ')}`);
      }
      if (snap.phase === 'reveal' && prev?.phase !== 'reveal') {
        const q = snap.question;
        const mine = snap.players.find((p) => p.id === me());
        if (mine) sfx.play(mine.pick === snap.correct ? 'coin' : mine.pick >= 0 ? 'error' : 'lose');
        announce(`Het goede antwoord is ${LETTERS[snap.correct]}: ${q.answers[snap.correct]}.${mine ? (mine.gain ? ` Goed! Plus ${mine.gain} punten.` : ' Helaas.') : ''}`);
      }
      if (snap.phase === 'end' && prev?.phase !== 'end') {
        sfx.play(snap.players[0]?.id === me() ? 'win' : 'lose');
        announce(`Eindstand: ${snap.players.map((p, i) => `${i + 1}. ${nameOf(p.id)} met ${p.score} punten`).join(', ')}.`);
      }
    },

    update(dt) {
      time += dt;
      if (snap?.phase === 'ask') {
        const s = Math.ceil(left());
        if (s <= 5 && s > 0 && s !== lastBeat) sfx.play('beat');
        lastBeat = s;
      }
    },

    render() {
      studio.blit(ctx);
      if (!snap) return;
      if (snap.phase === 'intro') {
        bulbs();
        intro();
        return;
      }
      if (snap.phase === 'end') {
        podium();
        return;
      }
      bulbs();
      header();
      board();
      tiles();
      scores();
      if (snap.phase === 'ask' && !canAnswer() && !snap.players.some((p) => p.id === me())) {
        drawText(ctx, 'Je kijkt mee', W / 2, 232, { color: '#c9d2ff', scale: 1.6, align: 'center' });
      }
    },

    unmount() {
      for (const fn of cleanups) fn();
    },
  };
}

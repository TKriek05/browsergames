// Blokval (client side): you play your own board locally (no input lag);
// every locked piece goes to the server, which checks it and sends back the
// truth (with incoming garbage). Unconfirmed locks are replayed on top of
// the server board, just like prediction + reconciliation.
import { C2S, BTN } from '../../../shared/messages.js';
import { PLAYER_COLORS } from '../../../shared/constants.js';
import {
  COLS, ROWS, HIDDEN, SHAPES, createSequence, emptyBoard, spawn, fits, dropY, tryRotate, place, decodeBoard, gravityInterval,
} from '../../../shared/games/blocks.js';
import { ARCADE_PHASE } from '../../../shared/games/arcade.js';
import { drawText } from '../../js/core/pixelfont.js';
import { createFx } from '../../js/core/fx.js';

export const meta = {
  width: 320, height: 180, pixelated: true, step: 1 / 60,
  touchButtons: [{ label: 'DRAAI', bit: BTN.X }, { label: 'VAL', bit: BTN.A }],
};

const COLORS = ['#000000', '#3ef0ff', '#ffe14d', '#c77dff', '#5dff8a', '#ff4d6d', '#3e7bff', '#ff9a3e', '#6a6f8a'];
const SHADOW = '#0b0b1e';
const DAS_S = 0.14;
const ARR_S = 0.035;
const LOCK_S = 0.5;
const MAX_LOCK_RESETS = 15;
const SOFT_FACTOR = 18;
const CELL = 8;
const BX = 12;
const BY = 12 - HIDDEN * CELL; // hidden rows sit above the visible board

export function createGame() {
  let net, session, input, sfx, ctx, fx;
  let snap = null;
  let seq = null;
  let board = emptyBoard();
  let idx = 0;
  let active = null;
  let gravityT = 0;
  let lockT = 0;
  let lockResets = 0;
  let dasDir = 0;
  let dasT = 0;
  let prevButtons = 0;
  let prevUp = false;
  let lastSentPiece = '';
  let lastPieceAt = 0;
  let serverResync = -1;
  let flash = 0;
  let lastCountdown = 0;
  const pending = []; // locks sent, not yet confirmed: { i, k, r, x, y }

  const mySlot = () => (session.myPlayer?.role === 'player' ? session.myPlayer.slot : -1);
  const hexOf = (slot) => PLAYER_COLORS[session.room?.players.find((p) => p.slot === slot)?.color ?? slot % 6].hex;
  const nameOf = (slot) => session.room?.players.find((p) => p.slot === slot)?.name ?? '?';
  const me = () => snap?.players.find((p) => p.slot === mySlot()) ?? null;
  const playing = () => snap?.phase === ARCADE_PHASE.PLAY && me()?.alive && active;

  function spawnActive() {
    if (!seq) return;
    const k = seq(idx);
    active = spawn(k);
    gravityT = 0;
    lockT = 0;
    lockResets = 0;
    if (!fits(board, k, 0, active.x, active.y)) {
      active = null;
      net.send(C2S.INPUT, { data: { t: 'topout' } });
    }
  }

  function lock(hard) {
    const { k, r, x, y } = active;
    const res = place(board, k, r, x, y);
    board = res.board;
    pending.push({ i: idx, k, r, x, y });
    net.send(C2S.INPUT, { data: { t: 'lock', i: idx, r, x, y } });
    idx++;
    if (res.lines) {
      flash = 0.15;
      sfx.play(res.lines >= 4 ? 'win' : 'coin');
    } else sfx.play(hard ? 'thud' : 'click');
    spawnActive();
  }

  function move(dx) {
    if (active && fits(board, active.k, active.r, active.x + dx, active.y)) {
      active.x += dx;
      touched();
      return true;
    }
    return false;
  }

  // Moving/rotating on the ground delays the lock (a limited number of times).
  function touched() {
    if (lockT > 0 && lockResets < MAX_LOCK_RESETS) {
      lockT = 0;
      lockResets++;
    }
  }

  function reconcile(mine) {
    const serverBoard = decodeBoard(mine.board);
    if (mine.resync !== serverResync) {
      serverResync = mine.resync;
      pending.length = 0;
      board = serverBoard;
      idx = mine.idx;
      spawnActive();
      return;
    }
    while (pending.length && pending[0].i < mine.idx) pending.shift();
    let b = serverBoard;
    for (const p of pending) {
      if (!fits(b, p.k, p.r, p.x, p.y)) {
        // Garbage moved things under our feet: the server will reject these too.
        pending.length = 0;
        break;
      }
      b = place(b, p.k, p.r, p.x, p.y).board;
    }
    board = b;
    const want = mine.idx + pending.length;
    if (idx !== want) {
      idx = want;
      spawnActive();
    }
    // Garbage pushed the stack up into the falling piece: lift it.
    if (active && !fits(board, active.k, active.r, active.x, active.y)) {
      for (let dy = 1; dy <= 4; dy++) {
        if (fits(board, active.k, active.r, active.x, active.y - dy)) {
          active.y -= dy;
          return;
        }
      }
      active = null;
      net.send(C2S.INPUT, { data: { t: 'topout' } });
    }
  }

  function drawCell(x, y, size, v, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = COLORS[v];
    ctx.fillRect(x, y, size, size);
    if (size >= 5) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(x, y, size, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x, y + size - 1, size, 1);
    }
    ctx.globalAlpha = 1;
  }

  function drawBoard(b, x0, y0, size, piece) {
    ctx.fillStyle = '#10102a';
    ctx.fillRect(x0, y0 + HIDDEN * size, COLS * size, (ROWS - HIDDEN) * size);
    for (let r = HIDDEN; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = b[r * COLS + c];
        if (v) drawCell(x0 + c * size, y0 + r * size, size, v);
      }
    }
    if (piece) {
      for (const [cx, cy] of SHAPES[piece.k][piece.r & 3]) {
        if (piece.y + cy >= HIDDEN) drawCell(x0 + (piece.x + cx) * size, y0 + (piece.y + cy) * size, size, piece.k + 1);
      }
    }
  }

  return {
    mount(view, netRef, c) {
      net = netRef;
      session = c.session;
      input = c.input;
      sfx = c.sfx;
      ctx = view.ctx;
      fx = createFx({ reducedMotion: c.reducedMotion });
    },

    onSnapshot(msg) {
      const prev = snap;
      snap = msg.state;
      if (!seq || prev?.seed !== snap.seed) {
        seq = createSequence(snap.seed);
        board = emptyBoard();
        idx = 0;
        pending.length = 0;
        serverResync = -1;
      }
      const mine = me();
      if (mine && snap.phase !== ARCADE_PHASE.COUNTDOWN) reconcile(mine);
      if (snap.phase === ARCADE_PHASE.PLAY && prev?.phase === ARCADE_PHASE.COUNTDOWN && mine && !active) spawnActive();
    },

    onEvent(msg) {
      const slot = mySlot();
      switch (msg.e) {
        case 'go': sfx.play('go'); break;
        case 'attack':
          if (msg.to === slot) { sfx.play('hit'); fx.text(`+${msg.n} ROMMEL`, BX + 40, 100, '#ff4d6d', 1, 1); }
          break;
        case 'garbage': if (msg.s === slot) fx.shake(3); break;
        case 'ko':
          sfx.play(msg.s === slot ? 'lose' : 'explode');
          fx.text(`${nameOf(msg.s).toUpperCase()} K.O.`, 220, 110, hexOf(msg.s), 1, 1.6);
          break;
        case 'end': sfx.play(msg.s === slot ? 'win' : 'countdown'); break;
        default: break;
      }
    },

    onReconnect() {
      serverResync = -1;
    },

    update(dt) {
      fx.update(dt);
      flash = Math.max(0, flash - dt);
      if (snap?.phase === ARCADE_PHASE.COUNTDOWN) {
        const left = Math.ceil(snap.left - 0.001);
        if (left !== lastCountdown && left > 0) sfx.play('countdown');
        lastCountdown = left;
      }
      const inp = input.sample();
      const pressed = inp.buttons & ~prevButtons;
      prevButtons = inp.buttons;
      const up = inp.ay < -0.5;
      const upPressed = up && !prevUp;
      prevUp = up;
      if (!playing()) return;

      // Left / right with auto-repeat (DAS/ARR)
      const dir = inp.ax < -0.5 ? -1 : inp.ax > 0.5 ? 1 : 0;
      if (dir !== dasDir) {
        dasDir = dir;
        dasT = 0;
        if (dir) move(dir);
      } else if (dir) {
        dasT += dt;
        while (dasT >= DAS_S + ARR_S) {
          dasT -= ARR_S;
          if (!move(dir)) break;
        }
      }
      // Rotate
      if (upPressed || pressed & BTN.X) {
        const r = tryRotate(board, active.k, active.r, active.x, active.y, 1);
        if (r) { Object.assign(active, r); touched(); sfx.play('hover'); }
      }
      if (pressed & (BTN.B | BTN.Y)) {
        const r = tryRotate(board, active.k, active.r, active.x, active.y, -1);
        if (r) { Object.assign(active, r); touched(); sfx.play('hover'); }
      }
      // Hard drop
      if (pressed & BTN.A) {
        active.y = dropY(board, active.k, active.r, active.x, active.y);
        lock(true);
        return;
      }
      // Gravity (soft drop = faster)
      const interval = gravityInterval(snap.level) / (inp.ay > 0.5 ? SOFT_FACTOR : 1);
      gravityT += dt;
      while (gravityT >= interval) {
        gravityT -= interval;
        if (fits(board, active.k, active.r, active.x, active.y + 1)) {
          active.y++;
          lockT = 0;
        } else break;
      }
      if (!fits(board, active.k, active.r, active.x, active.y + 1)) {
        lockT += dt;
        if (lockT >= LOCK_S) lock(false);
      }
      // Tell the others where the piece is (for their mini view).
      const key = active ? `${active.x},${active.y},${active.r}` : '';
      if (key && key !== lastSentPiece && performance.now() - lastPieceAt > 100) {
        lastSentPiece = key;
        lastPieceAt = performance.now();
        net.send(C2S.INPUT, { data: { t: 'piece', x: active.x, y: active.y, r: active.r } });
      }
    },

    render() {
      ctx.save();
      ctx.translate(fx.shakeX(), fx.shakeY());
      ctx.fillStyle = '#0b0b1e';
      ctx.fillRect(0, 0, 320, 180);
      if (!snap) { ctx.restore(); return; }
      const mine = me();
      const slot = mySlot();

      // Own board (or the first player's when watching)
      const focus = mine ?? snap.players[0];
      if (focus) {
        const b = mine ? board : decodeBoard(focus.board);
        drawBoard(b, BX, BY, CELL, null);
        if (mine && active && playing()) {
          const gy = dropY(board, active.k, active.r, active.x, active.y);
          for (const [cx, cy] of SHAPES[active.k][active.r]) {
            if (gy + cy >= HIDDEN) {
              ctx.strokeStyle = COLORS[active.k + 1];
              ctx.globalAlpha = 0.5;
              ctx.strokeRect(BX + (active.x + cx) * CELL + 0.5, BY + (gy + cy) * CELL + 0.5, CELL - 1, CELL - 1);
              ctx.globalAlpha = 1;
            }
          }
          for (const [cx, cy] of SHAPES[active.k][active.r]) {
            if (active.y + cy >= HIDDEN) drawCell(BX + (active.x + cx) * CELL, BY + (active.y + cy) * CELL, CELL, active.k + 1);
          }
        }
        ctx.strokeStyle = mine ? hexOf(slot) : '#3a3486';
        ctx.strokeRect(BX - 1.5, 10.5, COLS * CELL + 3, (ROWS - HIDDEN) * CELL + 3);
        if (flash > 0) {
          ctx.fillStyle = `rgba(255,255,255,${flash * 2})`;
          ctx.fillRect(BX, 12, COLS * CELL, (ROWS - HIDDEN) * CELL);
        }
        // Incoming garbage meter
        const pend = Math.min(20, focus.pending);
        if (pend) {
          ctx.fillStyle = '#ff4d6d';
          ctx.fillRect(BX - 7, 12 + (20 - pend) * CELL, 4, pend * CELL);
        }
        // Next pieces
        drawText(ctx, 'VOLGENDE', 98, 12, { color: '#a3a8d6' });
        if (seq) {
          for (let n = 1; n <= 3; n++) {
            const k = seq((mine ? idx : focus.idx) + n - (active || !mine ? 0 : 1));
            for (const [cx, cy] of SHAPES[k][0]) drawCell(100 + cx * 5, 16 + n * 16 + cy * 5, 5, k + 1);
          }
        }
        drawText(ctx, `NIVEAU ${snap.level}`, 98, 88, { color: '#ffffff' });
        drawText(ctx, `RIJEN ${focus.lines}`, 98, 98, { color: '#ffffff' });
        drawText(ctx, `ROMMEL ${focus.sent}`, 98, 108, { color: '#ff9a3e' });
        if (!mine) drawText(ctx, 'JE KIJKT MEE', 98, 124, { color: '#ffe14d' });
      }

      // The others, small
      const others = snap.players.filter((p) => p !== focus);
      const size = 3;
      others.forEach((p, i) => {
        const x = 150 + i * 34;
        const y = 22;
        drawText(ctx, nameOf(p.slot).slice(0, 5), x, 4, { color: hexOf(p.slot) });
        drawBoard(decodeBoard(p.board), x, y - HIDDEN * size, size, p.alive ? p.piece : null);
        ctx.strokeStyle = hexOf(p.slot);
        ctx.strokeRect(x - 0.5, y - 0.5, COLS * size + 1, (ROWS - HIDDEN) * size + 1);
        if (p.pending) {
          ctx.fillStyle = '#ff4d6d';
          ctx.fillRect(x - 3, y + (20 - Math.min(20, p.pending)) * size, 2, Math.min(20, p.pending) * size);
        }
        drawText(ctx, String(p.lines), x, y + 62, { color: '#ffffff' });
        if (!p.alive && snap.phase !== ARCADE_PHASE.COUNTDOWN) {
          ctx.fillStyle = 'rgba(11,11,30,0.7)';
          ctx.fillRect(x, y, COLS * size, (ROWS - HIDDEN) * size);
          drawText(ctx, p.place === 1 ? 'WIN' : `${p.place}E`, x + 15, y + 26, { color: p.place === 1 ? '#ffe14d' : '#ff4d6d', align: 'center' });
        }
      });

      if (snap.phase === ARCADE_PHASE.COUNTDOWN) {
        drawText(ctx, String(Math.max(1, Math.ceil(snap.left))), BX + 40, 70, { color: '#ffe14d', scale: 5, align: 'center', shadow: '#ff3ea5' });
      } else if (mine && !mine.alive) {
        drawText(ctx, mine.place === 1 ? 'GEWONNEN!' : 'K.O.', BX + 40, 80, { color: mine.place === 1 ? '#ffe14d' : '#ff4d6d', scale: 2, align: 'center', shadow: SHADOW });
      } else if (snap.phase === ARCADE_PHASE.END && mine?.alive) {
        drawText(ctx, 'GEWONNEN!', BX + 40, 80, { color: '#ffe14d', scale: 2, align: 'center', shadow: SHADOW });
      }
      fx.drawTexts(ctx);
      ctx.restore();
    },

    unmount() {},
  };
}

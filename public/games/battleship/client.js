// Zeeslag. Placement: pick a ship in the panel (or just click: the next ship
// is used), R rotates, "Willekeurig" fills everything. Then fire on the big
// board; your own fleet is shown small underneath.
import { createBoardModule } from '../board/kit.js';
import { h } from '../../js/core/ui.js';
import { THEME, clearBoard, roundRect, circle, clamp01, glow } from '../board/draw.js';
import { SIZE, FLEET, shipCells, randomPlacement } from '../../../shared/rules/battleship.js';

const W = 640;
const H = 900;
const BIG = { x: 80, y: 56, cell: 50 };
const SMALL = { x: 170, y: 632, cell: 26 };
const LETTERS = 'ABCDEFGHIJ';
const cellName = (c) => `${LETTERS[c % SIZE]}${Math.floor(c / SIZE) + 1}`;

const placing = (f) => f.view.phase === 'place';
const myPlacePending = (f) => placing(f) && f.you >= 0 && !f.view.boards[f.you].placed;

function drawGrid(ctx, g, label) {
  const size = g.cell * SIZE;
  roundRect(ctx, g.x - 4, g.y - 4, size + 8, size + 8, 10);
  ctx.fillStyle = '#0f2a55';
  ctx.fill();
  ctx.strokeStyle = 'rgba(62,240,255,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < SIZE; i++) {
    ctx.moveTo(g.x + i * g.cell, g.y);
    ctx.lineTo(g.x + i * g.cell, g.y + size);
    ctx.moveTo(g.x, g.y + i * g.cell);
    ctx.lineTo(g.x + size, g.y + i * g.cell);
  }
  ctx.stroke();
  ctx.fillStyle = THEME.muted;
  ctx.font = `600 ${Math.round(g.cell * 0.34)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < SIZE; i++) {
    ctx.fillText(LETTERS[i], g.x + i * g.cell + g.cell / 2, g.y - g.cell * 0.4);
    ctx.fillText(String(i + 1), g.x - g.cell * 0.45, g.y + i * g.cell + g.cell / 2);
  }
  ctx.fillStyle = THEME.text;
  ctx.font = '700 18px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(label, g.x, g.y - g.cell * 0.4 - 22);
}

function drawShip(ctx, g, ship, len, { color = '#8a8fb8', alpha = 1, outline = false } = {}) {
  const x = g.x + ship.x * g.cell + 4;
  const y = g.y + ship.y * g.cell + 4;
  const w = (ship.dir === 'h' ? len : 1) * g.cell - 8;
  const hh = (ship.dir === 'v' ? len : 1) * g.cell - 8;
  ctx.save();
  ctx.globalAlpha = alpha;
  roundRect(ctx, x, y, w, hh, g.cell * 0.4);
  if (outline) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}

function drawShots(ctx, g, shots) {
  for (let c = 0; c < SIZE * SIZE; c++) {
    const v = shots[c];
    if (!v) continue;
    const x = g.x + (c % SIZE) * g.cell + g.cell / 2;
    const y = g.y + Math.floor(c / SIZE) * g.cell + g.cell / 2;
    if (v === 2) {
      const s = g.cell * 0.28;
      ctx.strokeStyle = THEME.red;
      ctx.lineWidth = Math.max(2, g.cell * 0.1);
      ctx.beginPath();
      ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s);
      ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s);
      ctx.stroke();
    } else {
      circle(ctx, x, y, g.cell * (v === 3 ? 0.07 : 0.12));
      ctx.fillStyle = v === 3 ? 'rgba(238,240,255,0.35)' : 'rgba(238,240,255,0.85)';
      ctx.fill();
    }
  }
}

function cellAt(g, x, y) {
  const col = Math.floor((x - g.x) / g.cell);
  const row = Math.floor((y - g.y) / g.cell);
  return col >= 0 && col < SIZE && row >= 0 && row < SIZE ? row * SIZE + col : null;
}

// Local placement helpers
const nextShip = (local) => local.layout.findIndex((s) => !s);

// Are all placed ships (any subset, in any order) inside the grid, without
// overlap and, unless allowed, without touching?
function validSubset(layout, touching) {
  const taken = [];
  for (let k = 0; k < layout.length; k++) {
    const s = layout[k];
    if (!s) continue;
    const len = FLEET[k].len;
    if (s.x < 0 || s.y < 0 || (s.dir === 'h' ? s.x + len > SIZE : s.y + len > SIZE)) return false;
    const cells = shipCells(s, len);
    for (const c of cells) {
      for (const oc of taken) {
        const dx = Math.abs((oc % SIZE) - (c % SIZE));
        const dy = Math.abs(Math.floor(oc / SIZE) - Math.floor(c / SIZE));
        if (oc === c || (!touching && dx <= 1 && dy <= 1)) return false;
      }
    }
    taken.push(...cells);
  }
  return true;
}

export const { meta, createGame } = createBoardModule({
  id: 'battleship',
  width: W,
  height: H,

  seatLabel: (seat, f) => {
    const b = f.view.boards[seat];
    const n = b.placed ? b.afloat : FLEET.length;
    return `${f.colorNameOf(seat)} · ${n} ${n === 1 ? 'schip' : 'schepen'}${b.placed || f.view.phase !== 'place' ? '' : ' (plaatst…)'}`;
  },
  seatIcon: () => '⚓',
  initLocal: () => ({ layout: FLEET.map(() => null), current: 0, dir: 'h', touching: false, sent: false }),
  onReset: (local) => Object.assign(local, { layout: FLEET.map(() => null), current: 0, dir: 'h', sent: false }),

  cursor: { cols: SIZE, rows: SIZE, target: (col, row) => row * SIZE + col },

  pick: (x, y) => cellAt(BIG, x, y),

  onPick(c, api, f) {
    const local = f.local;
    local.touching = f.view.touching;
    if (myPlacePending(f)) {
      // Clicking a placed ship picks it up again.
      const own = local.layout.findIndex((s, k) => s && shipCells(s, FLEET[k].len).includes(c));
      if (own >= 0) {
        local.layout[own] = null;
        local.current = own;
        api.refresh();
        return;
      }
      if (local.current < 0 || c === null) return;
      const ship = { x: c % SIZE, y: Math.floor(c / SIZE), dir: local.dir };
      const trial = local.layout.map((sh, k) => (k === local.current ? ship : sh));
      if (!validSubset(trial, local.touching)) {
        api.sfx.play('error');
        return;
      }
      local.layout[local.current] = ship;
      local.current = nextShip(local);
      api.sfx.play('click');
      api.refresh();
      return;
    }
    if (!placing(f) && f.myTurn && !f.view.boards[1 - f.you].shots[c]) api.move({ type: 'fire', c });
  },

  onKey(key, api, f) {
    if (myPlacePending(f) && (key === 'r' || key === 'R')) {
      f.local.dir = f.local.dir === 'h' ? 'v' : 'h';
      return true;
    }
    return false;
  },

  describe(last, f) {
    const i = last.info;
    if (i.placed) return `${f.nameOf(last.seat)} ${last.seat === f.you ? 'hebt' : 'heeft'} de vloot geplaatst.`;
    let t = `${f.nameOf(last.seat)} schoot op ${cellName(i.c)}: ${i.hit ? 'raak!' : 'mis.'}`;
    if (i.sunk) t += ` ${i.sunk.name} gezonken!`;
    return t;
  },
  animMs: (last) => (last.info.placed ? 0 : 650),
  sound: (last) => (last.info.placed ? 'ready' : last.info.sunk ? 'explode' : last.info.hit ? 'hit' : 'click'),
  turnText: (f) => {
    if (myPlacePending(f)) return 'Plaats je vloot.';
    if (placing(f)) return 'Wachten tot de ander de vloot heeft geplaatst…';
    return 'Jouw beurt: kies een vak om op te schieten!';
  },

  panel(el, f, api) {
    const local = f.local;
    local.touching = f.view.touching;
    if (!myPlacePending(f)) {
      if (f.view.phase === 'fire') {
        const sunk = f.you >= 0 ? f.view.boards[1 - f.you].sunk.map((s) => s.name) : [];
        el.append(h('ul', { class: 'fleet-list', 'aria-label': 'Vloot van de tegenstander' },
          ...FLEET.map((s) => h('li', { class: sunk.includes(s.name) ? 'is-sunk' : '' }, `${s.name} (${s.len})`, sunk.includes(s.name) ? ' – gezonken' : ''))));
      }
      return;
    }
    const list = h('ul', { class: 'fleet-list', 'aria-label': 'Jouw schepen' });
    FLEET.forEach((s, k) => {
      const done = !!local.layout[k];
      list.append(h('li', { class: `${k === local.current ? 'is-current' : ''} ${done ? 'is-done' : ''}` },
        h('button', {
          class: 'btn btn--small', type: 'button', 'data-key': `ship-${k}`,
          onclick: () => { local.layout[k] = null; local.current = k; api.refresh(); },
        }, `${done ? '✓ ' : ''}${s.name} (${s.len})`)));
    });
    const complete = local.layout.every(Boolean);
    el.append(
      list,
      h('div', { class: 'promo' },
        h('button', { class: 'btn', type: 'button', 'data-key': 'rotate', onclick: () => { local.dir = local.dir === 'h' ? 'v' : 'h'; api.refresh(); } },
          `Draai (R): ${local.dir === 'h' ? 'liggend' : 'staand'}`),
        h('button', {
          class: 'btn', type: 'button', 'data-key': 'shuffle',
          onclick: () => { local.layout = randomPlacement(Math.random, local.touching); local.current = -1; api.refresh(); },
        }, 'Willekeurig'),
        h('button', { class: 'btn', type: 'button', 'data-key': 'clear', onclick: () => { local.layout = FLEET.map(() => null); local.current = 0; api.refresh(); } }, 'Wis'),
      ),
      h('button', {
        class: 'btn btn--primary', type: 'button', 'data-key': 'ready', disabled: !complete || local.sent,
        onclick: () => { local.sent = true; api.move({ type: 'place', ships: local.layout }); },
      }, 'Klaar, ten strijde!'),
    );
  },

  draw(ctx, f) {
    clearBoard(ctx, W, H);
    const v = f.view;
    const me = f.you >= 0 ? f.you : 0;
    const opp = 1 - me;
    const local = f.local;

    if (myPlacePending(f)) {
      drawGrid(ctx, BIG, 'Plaats je vloot');
      local.layout.forEach((s, k) => s && drawShip(ctx, BIG, s, FLEET[k].len, { color: '#9aa0d0' }));
      const target = f.cursor ? f.cursor.row * SIZE + f.cursor.col : f.hover;
      if (local.current >= 0 && target !== null && target !== undefined) {
        const ship = { x: target % SIZE, y: Math.floor(target / SIZE), dir: local.dir };
        const trial = local.layout.map((s, k) => (k === local.current ? ship : s));
        const ok = validSubset(trial, v.touching);
        drawShip(ctx, BIG, ship, FLEET[local.current].len, { color: ok ? THEME.green : THEME.red, alpha: 0.6 });
      }
      return;
    }

    // Big board: the opponent's water (for spectators: seat 1's board).
    const oppBoard = v.boards[opp];
    drawGrid(ctx, BIG, f.you >= 0 ? 'Vijandelijke wateren' : `Water van ${f.nameOf(opp)}`);
    if (oppBoard.ships) oppBoard.ships.forEach((s, k) => drawShip(ctx, BIG, s, FLEET[k].len, { color: '#8a8fb8', alpha: 0.35 }));
    for (const sunk of oppBoard.sunk) {
      const cells = sunk.cells;
      const x = Math.min(...cells.map((c) => c % SIZE));
      const y = Math.min(...cells.map((c) => Math.floor(c / SIZE)));
      const dir = cells.length > 1 && cells[1] - cells[0] === 1 ? 'h' : 'v';
      drawShip(ctx, BIG, { x, y, dir }, cells.length, { color: THEME.red, alpha: 0.9, outline: true });
    }
    drawShots(ctx, BIG, oppBoard.shots);

    // Small board: my fleet
    const myBoard = v.boards[me];
    drawGrid(ctx, SMALL, f.you >= 0 ? 'Jouw vloot' : `Vloot van ${f.nameOf(me)}`);
    if (myBoard.ships) myBoard.ships.forEach((s, k) => drawShip(ctx, SMALL, s, FLEET[k].len, { color: '#9aa0d0' }));
    drawShots(ctx, SMALL, myBoard.shots);

    // Aim
    if (v.phase === 'fire' && f.myTurn) {
      const target = f.cursor ? f.cursor.row * SIZE + f.cursor.col : f.hover;
      if (target !== null && target !== undefined) {
        const x = BIG.x + (target % SIZE) * BIG.cell + BIG.cell / 2;
        const y = BIG.y + Math.floor(target / SIZE) * BIG.cell + BIG.cell / 2;
        const free = !oppBoard.shots[target];
        glow(ctx, free ? THEME.yellow : THEME.muted, 10, () => {
          ctx.strokeStyle = free ? THEME.yellow : THEME.muted;
          ctx.lineWidth = 3;
          circle(ctx, x, y, BIG.cell * 0.36);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x - BIG.cell * 0.5, y); ctx.lineTo(x + BIG.cell * 0.5, y);
          ctx.moveTo(x, y - BIG.cell * 0.5); ctx.lineTo(x, y + BIG.cell * 0.5);
          ctx.stroke();
        });
      }
    }

    // Splash / explosion for the last shot
    const last = f.last;
    if (last && last.info.c !== undefined && f.anim < 1) {
      const g = last.seat === me ? BIG : SMALL;
      const x = g.x + (last.info.c % SIZE) * g.cell + g.cell / 2;
      const y = g.y + Math.floor(last.info.c / SIZE) * g.cell + g.cell / 2;
      const t = clamp01(f.anim);
      ctx.save();
      ctx.globalAlpha = 1 - t;
      circle(ctx, x, y, g.cell * (0.2 + t * (last.info.hit ? 1.2 : 0.8)));
      ctx.strokeStyle = last.info.hit ? THEME.yellow : THEME.cyan;
      ctx.lineWidth = 4;
      ctx.stroke();
      if (last.info.hit) {
        circle(ctx, x, y, g.cell * 0.5 * (1 - t));
        ctx.fillStyle = '#ff9a3e';
        ctx.fill();
      }
      ctx.restore();
    }
  },
});

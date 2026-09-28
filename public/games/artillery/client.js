// Knalkanon (client side): the landscape on the canvas, controls in the side
// panel. Aim by dragging from your cannon (or ←/→ and ↑/↓), drive with A/D,
// weapons 1-3, fire with space. Shots are animated along the path the
// server computed; the crater arrives with the next snapshot.
import { PLAYER_COLORS } from '../../../shared/constants.js';
import { ART, WEAPONS, flyShell, muzzle } from '../../../shared/games/artillery.js';
import { h, clear, preserveFocus } from '../../js/core/ui.js';
import { createSharpLayer } from '../../js/core/canvas.js';
import { drawText } from '../../js/core/hudtext.js';
import { W, H, sy, THEMES, drawSky, drawGround, drawSea, drawCannon, drawHealth, drawWind } from './draw.js';

export const meta = { width: W, height: H, pixelated: false, step: 1 / 60, layout: 'board', input: false, touchControls: false };

const PATH_STEP_S = ART.DT * 3; // one path point per 3 simulation steps
const AIM_SEND_MS = 120;
const PREVIEW_S = 0.32; // how much of the flight the aiming line shows
const SHADOW = '#1a1a24';

export function createGame() {
  let view, ctx, net, session, sfx, side, reduced;
  let snap = null;
  let terrain = null;
  let sky = null;
  let skyTheme = '';
  let time = 0;
  let shake = 0;
  let banner = null;
  let lastSent = 0;
  let aimDirty = false;
  const aim = { angle: 60, power: 60, weapon: 0, editing: false };
  const keys = new Set();
  const anims = []; // shots in flight: { paths, booms, t0, color, done }
  const parts = []; // particles: { x, y, vx, vy, life, max, color, size, smoke }
  const el = {};
  const cleanups = [];

  const me = () => session.me;
  const player = (id) => session.room?.players.find((p) => p.id === id) ?? null;
  const colorOf = (id) => PLAYER_COLORS[player(id)?.color ?? 0].hex;
  const nameOf = (id) => (id === me() ? 'Jij' : player(id)?.name ?? '?');
  const myCannon = () => snap?.cannons.find((c) => c.id === me()) ?? null;
  const myTurn = () => snap?.phase === 'aim' && snap.turn === me() && !anims.length;
  const left = () => (snap ? Math.max(0, snap.left - (performance.now() - snap.at) / 1000) : 0);

  function send(data) {
    net.send('input', { data });
  }

  function setAim(angle, power) {
    aim.angle = Math.round(Math.max(0, Math.min(180, angle)) * 10) / 10;
    aim.power = Math.round(Math.max(5, Math.min(100, power)) * 10) / 10;
    aim.editing = true;
    aimDirty = true;
  }

  function fire() {
    if (!myTurn()) return;
    send({ type: 'fire', angle: aim.angle, power: aim.power, weapon: aim.weapon });
    aimDirty = false;
  }

  function move(dir) {
    if (myTurn()) send({ type: 'move', dir, angle: aim.angle, power: aim.power });
  }

  function pickWeapon(i) {
    const c = myCannon();
    if (!c || c.ammo[i] === 0 || !myTurn()) return;
    aim.weapon = i;
    send({ type: 'weapon', weapon: i });
    renderPanel();
  }

  // --- Particles -----------------------------------------------------------------------
  function burst(x, y, r, color) {
    const n = reduced ? 10 : 34;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI;
      const v = 40 + Math.random() * r * 5;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1.2, max: 1.2, color, size: 2 + Math.random() * 2.5, smoke: false });
    }
    for (let i = 0; i < (reduced ? 4 : 12); i++) {
      parts.push({ x: x + (Math.random() - 0.5) * r, y: y + Math.random() * r * 0.5, vx: (Math.random() - 0.5) * 20, vy: 20 + Math.random() * 30, life: 1.6, max: 1.6, color: '#5a5550', size: r * 0.35 + Math.random() * 8, smoke: true });
    }
    if (parts.length > 400) parts.splice(0, parts.length - 400);
    if (!reduced) shake = Math.max(shake, Math.min(8, r / 5));
  }

  function stepParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        parts.splice(i, 1);
        continue;
      }
      if (!p.smoke) p.vy -= ART.G * 0.8 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  // --- Side panel -------------------------------------------------------------------------
  function buildPanel() {
    clear(side);
    el.status = h('p', { class: 'bp__status', role: 'status', 'aria-live': 'polite' }, 'Laden…');
    el.seats = h('ol', { class: 'bp__seats' });
    el.controls = h('div', { class: 'bp__extra' });
    side.append(h('div', { class: 'bp__head' }, h('h2', { class: 'bp__title' }, 'Knalkanon'), el.round = h('span', { class: 'bp__round' })), el.seats, el.status, el.controls);
  }

  function renderPanel() {
    if (!snap || !side) return;
    preserveFocus(side, () => {
      el.round.textContent = snap.rounds > 1 ? `Ronde ${snap.round}` : '';
      clear(el.seats);
      for (const c of snap.cannons) {
        el.seats.append(h('li', { class: `bp__seat ${snap.turn === c.id && snap.phase === 'aim' ? 'is-turn' : ''} ${c.id === me() ? 'is-me' : ''}` },
          h('span', { class: 'player__chip player__chip--seat', dataset: { color: String(player(c.id)?.color ?? 0) }, 'aria-hidden': 'true' }),
          h('span', { class: 'bp__seat-text' }, h('strong', {}, nameOf(c.id)), h('small', {}, c.alive ? `${c.hp} leven` : 'uitgeschakeld')),
          h('span', { class: 'bp__seat-score', title: 'Gewonnen rondes' }, snap.rounds > 1 ? String(c.wins) : '')));
      }
      clear(el.controls);
      const c = myCannon();
      if (!c || !myTurn()) return;
      const range = (id, label, min, max, value, onInput) => h('div', { class: 'field art-range' },
        h('label', { for: id }, `${label}: ${Math.round(value)}`),
        h('input', { id, type: 'range', min: String(min), max: String(max), step: '1', value: String(value), 'data-key': id, class: 'art-range__input', oninput: onInput }));
      el.controls.append(
        h('div', { class: 'bp__row', role: 'group', 'aria-label': 'Wapen' }, ...WEAPONS.map((w, i) => h('button', {
          class: `btn btn--small ${aim.weapon === i ? 'btn--primary' : ''}`, type: 'button', 'data-key': `weapon-${i}`,
          'aria-pressed': String(aim.weapon === i), disabled: c.ammo[i] === 0, onclick: () => pickWeapon(i),
        }, `${i + 1}. ${w.name}${w.ammo > 0 ? ` (${c.ammo[i]})` : ''}`))),
        range('art-angle', 'Hoek', 0, 180, aim.angle, (e) => { setAim(Number(e.target.value), aim.power); }),
        range('art-power', 'Kracht', 5, 100, aim.power, (e) => { setAim(aim.angle, Number(e.target.value)); }),
        h('div', { class: 'bp__row' },
          h('button', { class: 'btn btn--small', type: 'button', 'data-key': 'left', disabled: c.fuel < ART.MOVE_STEP, onclick: () => move(-1) }, '◀ Rijd'),
          h('button', { class: 'btn btn--small', type: 'button', 'data-key': 'right', disabled: c.fuel < ART.MOVE_STEP, onclick: () => move(1) }, 'Rijd ▶'),
          h('span', { class: 'muted small' }, `brandstof ${c.fuel}`)),
        h('button', { class: 'btn btn--primary btn--big', type: 'button', 'data-key': 'fire', onclick: fire }, '💥 Vuur!'),
      );
    });
    const turn = snap.cannons.find((x) => x.id === snap.turn);
    let text = '';
    if (snap.phase === 'intro') text = 'Kanonnen in positie…';
    else if (snap.phase === 'aim') text = myTurn() ? 'Jouw beurt: richt en vuur!' : `${nameOf(snap.turn)} ${turn ? 'is aan de beurt…' : ''}`;
    else if (snap.phase === 'flight') text = 'Boem…';
    else if (snap.phase === 'roundEnd') text = 'Ronde voorbij!';
    else if (snap.phase === 'end') text = 'Einde!';
    if (el.status.textContent !== text) el.status.textContent = text;
  }

  // --- Input ------------------------------------------------------------------------------------
  function bind(canvas) {
    let dragging = false;
    const aimAt = (e) => {
      const c = myCannon();
      if (!c) return;
      const p = view.toLogical(e.clientX, e.clientY);
      const dx = p.x - c.x;
      const dy = sy(c.y + 7) - p.y;
      setAim((Math.atan2(Math.max(0, dy), dx) * 180) / Math.PI, Math.hypot(dx, dy) / 2.2);
      renderPanel();
    };
    const down = (e) => {
      if (!myTurn()) return;
      dragging = true;
      canvas.setPointerCapture?.(e.pointerId);
      aimAt(e);
    };
    const moveP = (e) => { if (dragging) aimAt(e); };
    const up = () => { dragging = false; };
    const keydown = (e) => {
      if (e.target?.closest?.('input, textarea, select, dialog, button')) {
        if (e.key !== ' ' || e.target?.tagName === 'INPUT') return;
      }
      const k = e.key;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) {
        keys.add(k);
        e.preventDefault();
      } else if (k === ' ' || k === 'Enter') {
        if (myTurn()) {
          fire();
          e.preventDefault();
        }
      } else if (k === 'a' || k === 'A') move(-1);
      else if (k === 'd' || k === 'D') move(1);
      else if (k >= '1' && k <= '3') pickWeapon(Number(k) - 1);
    };
    const keyup = (e) => keys.delete(e.key);
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', moveP);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    cleanups.push(() => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', moveP);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
    });
  }

  return {
    mount(v, netRef, c) {
      view = v;
      ctx = v.ctx;
      net = netRef;
      session = c.session;
      sfx = c.sfx;
      side = c.side;
      reduced = c.reducedMotion;
      view.canvas.tabIndex = 0;
      view.canvas.style.touchAction = 'none';
      view.canvas.setAttribute('aria-label', 'Knalkanon: sleep vanaf je kanon om te richten, spatie om te vuren');
      buildPanel();
      bind(view.canvas);
    },

    onSnapshot(msg) {
      const prev = snap;
      snap = msg.state;
      snap.at = performance.now();
      if (snap.terrain) terrain = snap.terrain;
      if (snap.theme !== skyTheme) {
        skyTheme = snap.theme;
        const th = THEMES[skyTheme] ?? THEMES.gras;
        sky = createSharpLayer(view, (g) => drawSky(g, th));
      }
      const mine = myCannon();
      // A new turn of mine: start from where my barrel points.
      if (mine && snap.phase === 'aim' && snap.turn === me() && (prev?.turn !== me() || prev?.phase !== 'aim')) {
        aim.angle = mine.angle;
        aim.power = mine.power;
        aim.weapon = mine.ammo[mine.weapon] === 0 ? 0 : mine.weapon;
        aim.editing = false;
      }
      renderPanel();
    },

    onEvent(msg) {
      switch (msg.e) {
        case 'shot':
          anims.push({ paths: msg.paths, booms: msg.booms, t0: performance.now(), color: colorOf(msg.by), done: false });
          sfx.play(msg.weapon === 1 ? 'explode' : 'shoot');
          break;
        case 'destroyed':
          banner = { text: msg.id === me() ? 'KAPOT!' : 'RAAK!', sub: `${nameOf(msg.id)} ${msg.id === me() ? 'bent' : 'is'} uitgeschakeld`, color: msg.id === me() ? '#ff5c5c' : '#ffe14d', until: performance.now() + 1800 };
          break;
        case 'turn':
          if (msg.id === me()) sfx.play('ready');
          break;
        case 'timeout':
          banner = { text: 'TE LAAT', sub: `${nameOf(msg.id)} liet de beurt voorbij gaan`, color: '#ffffff', until: performance.now() + 1500 };
          break;
        case 'roundEnd':
          banner = { text: msg.id === me() ? 'JIJ WINT!' : msg.id ? `${nameOf(msg.id).toUpperCase()} WINT` : 'GELIJKSPEL', sub: '', color: msg.id ? colorOf(msg.id) : '#ffffff', until: performance.now() + 3500 };
          sfx.play(msg.id === me() ? 'win' : 'countdown');
          break;
        case 'end': sfx.play('win'); break;
        default: break;
      }
    },

    update(dt) {
      time += dt;
      shake = Math.max(0, shake - dt * 14);
      stepParts(dt);
      if (myTurn() && keys.size) {
        const fast = 1;
        let a = aim.angle;
        let p = aim.power;
        if (keys.has('ArrowLeft')) a += 35 * dt * fast;
        if (keys.has('ArrowRight')) a -= 35 * dt * fast;
        if (keys.has('ArrowUp')) p += 30 * dt;
        if (keys.has('ArrowDown')) p -= 30 * dt;
        setAim(a, p);
      }
      const now = performance.now();
      if (aimDirty && myTurn() && now - lastSent > AIM_SEND_MS) {
        send({ type: 'aim', angle: aim.angle, power: aim.power });
        aimDirty = false;
        lastSent = now;
        renderPanel();
      }
    },

    render() {
      const th = THEMES[snap?.theme] ?? THEMES.gras;
      ctx.save();
      if (shake) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      if (sky) sky.blit(ctx);
      else {
        ctx.fillStyle = th.sky[0];
        ctx.fillRect(0, 0, W, H);
      }
      drawGround(ctx, terrain, th);
      drawSea(ctx, th, time);
      if (!snap) {
        ctx.restore();
        return;
      }
      const now = performance.now();
      for (const c of snap.cannons) {
        if (!c.alive) continue;
        const mine = c.id === me() && myTurn();
        const shown = mine && aim.editing ? { ...c, angle: aim.angle } : c;
        drawCannon(ctx, shown, colorOf(c.id), { turn: snap.turn === c.id && snap.phase === 'aim', time });
        drawHealth(ctx, c.x, c.y, c.hp, colorOf(c.id));
        drawText(ctx, nameOf(c.id), c.x, sy(c.y) - 36 + (snap.turn === c.id && snap.phase === 'aim' ? -12 : 0), { color: '#ffffff', scale: 1.1, align: 'center', shadow: SHADOW });
      }
      // Aiming line for your own shot (only the first part: the rest is skill).
      const mine = myCannon();
      if (mine && myTurn() && terrain) {
        const start = muzzle(mine.x, mine.y, aim.angle);
        const res = flyShell(terrain, start.x, start.y, aim.angle, aim.power, snap.wind, []);
        const pts = res.path;
        const upto = Math.min(pts.length / 2, Math.ceil(PREVIEW_S / PATH_STEP_S));
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        for (let i = 1; i < upto; i++) {
          ctx.beginPath();
          ctx.arc(pts[i * 2], sy(pts[i * 2 + 1]), 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Shells in flight.
      for (let k = anims.length - 1; k >= 0; k--) {
        const a = anims[k];
        const elapsed = (now - a.t0) / 1000;
        let flying = false;
        a.paths.forEach((path) => {
          const n = path.length / 2;
          const f = elapsed / PATH_STEP_S;
          const i = Math.min(n - 1, Math.floor(f));
          if (f < n - 1) flying = true;
          const t = Math.min(1, f - i);
          const j = Math.min(n - 1, i + 1);
          const x = path[i * 2] + (path[j * 2] - path[i * 2]) * t;
          const y = path[i * 2 + 1] + (path[j * 2 + 1] - path[i * 2 + 1]) * t;
          if (f < n - 1) {
            ctx.fillStyle = '#23252d';
            ctx.beginPath();
            ctx.arc(x, sy(y), 3.2, 0, Math.PI * 2);
            ctx.fill();
            if (!reduced && Math.random() < 0.5) parts.push({ x, y, vx: 0, vy: 6, life: 0.5, max: 0.5, color: '#d8d4cc', size: 2.5, smoke: true });
          }
        });
        if (!flying && !a.done) {
          a.done = true;
          for (const b of a.booms) burst(b.x, b.y, b.r, th.dirt[0]);
          if (a.booms.length) sfx.play('explode');
        }
        if (a.done && elapsed > 0.1 + Math.max(...a.paths.map((p) => p.length / 2)) * PATH_STEP_S) anims.splice(k, 1);
      }
      // Explosion flashes + particles.
      for (const p of parts) {
        ctx.globalAlpha = Math.min(1, (p.life / p.max) * (p.smoke ? 0.6 : 1.2));
        ctx.fillStyle = p.smoke ? p.color : p.life > p.max * 0.75 ? '#ffd23e' : p.color;
        ctx.beginPath();
        ctx.arc(p.x, sy(p.y), p.size * (p.smoke ? 1 + (1 - p.life / p.max) : 1), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // --- HUD ---
      drawWind(ctx, snap.wind);
      drawText(ctx, 'WIND', W / 2, 32, { color: '#ffffff', scale: 0.9, align: 'center', shadow: SHADOW });
      if (snap.phase === 'aim') {
        const s = Math.ceil(left());
        drawText(ctx, String(s), W - 12, 8, { color: s <= 5 ? '#ff6b5a' : '#ffffff', scale: 2.2, align: 'right', shadow: SHADOW });
        if (myTurn()) {
          const w = WEAPONS[aim.weapon];
          drawText(ctx, `${w.name} · hoek ${Math.round(aim.angle)}° · kracht ${Math.round(aim.power)}`, 10, 10, { color: '#ffffff', scale: 1.2, shadow: SHADOW });
        }
      }
      if (snap.phase === 'intro') drawText(ctx, snap.rounds > 1 ? `RONDE ${snap.round}` : 'KNALKANON', W / 2, H / 2 - 50, { color: '#ffe14d', scale: 4, align: 'center', shadow: SHADOW });
      if (snap.phase === 'end') drawText(ctx, 'EINDE!', W / 2, H / 2 - 50, { color: '#ffe14d', scale: 4, align: 'center', shadow: SHADOW });
      else if (banner && now < banner.until) {
        drawText(ctx, banner.text, W / 2, H / 2 - 60, { color: banner.color, scale: 3.4, align: 'center', shadow: SHADOW });
        if (banner.sub) drawText(ctx, banner.sub, W / 2, H / 2 - 22, { color: '#ffffff', scale: 1.4, align: 'center', shadow: SHADOW });
      }
    },

    unmount() {
      for (const fn of cleanups) fn();
    },
  };
}

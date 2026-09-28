// Minigolf (client side). The server rolls the balls; we interpolate them.
// Aiming is local: drag back and let go (mouse or touch, like a slingshot),
// or turn with ←/→, set the power with ↑/↓ and hit with space/A. A shot is
// one JSON action { a, p }. 3D view with a 2D HUD, flat without WebGL.
import { C2S, BTN } from '../../../shared/messages.js';
import { HOLES, BALL_STATE, CUP_R } from '../../../shared/games/minigolf.js';
import { createArcadeCore, ARCADE_PHASE, lerp } from '../common/arcade.js';
import { drawText } from '../../js/core/pixelfont.js';
import { rgb } from '../../js/gl/mesh.js';
import { createGolfScene } from './scene.js';

export const meta = {
  width: 480, height: 270, pixelated: true, gl: true, step: 1 / 30,
  touchControls: false, // drag on the course directly
};

const SHADOW = '#0b0b1e';
const DRAG_FULL = 70; // world units of drag for full power
const MIN_POWER = 0.04;
const TURN_SPEED = 1.5; // rad/s with keys
const FINE_TURN = 0.35; // rad/s with keys while holding B (shift)
const POWER_SPEED = 0.7; // per second with keys
const PENDING_MS = 1500; // wait this long for the server to accept a shot
const FLAT = { s: 1.75, cx: 140, cy: 80 };

function decode(r, time) {
  const s = { time, phase: r.u8(), endsAt: 0, ents: [] };
  s.endsAt = time + r.f32() * 1000;
  s.holeNo = r.u8();
  s.holes = r.u8();
  s.hole = r.u8();
  const n = r.u8();
  for (let i = 0; i < n; i++) {
    const e = { slot: r.u8(), flags: r.u8(), x: r.f32(), y: r.f32(), state: r.u8(), strokes: r.u8(), scores: [] };
    const k = r.u8();
    for (let j = 0; j < k; j++) e.scores.push(r.u8());
    s.ents.push(e);
  }
  return s;
}

// Total of the finished holes (+ the strokes on the current one while playing).
function runningTotal(e, s) {
  let t = 0;
  for (let i = 0; i < e.scores.length; i++) t += e.scores[i];
  if (e.scores.length <= s.holeNo) t += e.strokes;
  return t;
}

export function createGame() {
  const core = createArcadeCore({ decode });
  let view, ctx, input, sfx, net, scene;
  let banner = null; // { text, color, until }
  const aim = { angle: 0, power: 0.4, dragging: false, start: null, pointer: -1, turnReady: false };
  let pending = null; // { strokes, at }
  let prevA = false;
  const scratch = { x: 0, y: 0, depth: 0 };
  const g = { x: 0, y: 0, z: 0 };
  const placed = []; // name tags drawn this frame
  const cleanups = [];

  const hole = () => HOLES[core.latest?.hole ?? 0];

  // Can I hit the ball right now?
  function canAim() {
    const s = core.latest;
    const me = core.mine();
    if (!s || !me || s.phase !== ARCADE_PHASE.PLAY || me.state !== BALL_STATE.REST) return false;
    if (pending && me.strokes <= pending.strokes && performance.now() - pending.at < PENDING_MS) return false;
    return true;
  }

  function shoot() {
    const me = core.mine();
    if (!canAim() || aim.power < MIN_POWER) return;
    const a = Math.round(aim.angle * 1000) / 1000;
    const p = Math.round(Math.min(1, aim.power) * 1000) / 1000;
    net.send(C2S.INPUT, { data: { a, p } });
    pending = { strokes: me.strokes, at: performance.now() };
    aim.turnReady = false;
    sfx.play('putt');
  }

  // Pointer position → game coordinates on the course.
  function toGround(e) {
    const p = view.toLogical(e.clientX, e.clientY);
    if (scene) return scene.ground(p.x, p.y, g) ? { x: g.x, y: g.y } : null;
    return { x: (p.x - view.width / 2) / FLAT.s + FLAT.cx, y: (p.y - view.height / 2 - 5) / FLAT.s + FLAT.cy };
  }

  function onDown(e) {
    if (!canAim() || aim.dragging) return;
    const p = toGround(e);
    if (!p) return;
    aim.dragging = true;
    aim.start = p;
    aim.pointer = e.pointerId;
    aim.power = 0;
    view.canvas.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  function onMove(e) {
    if (!aim.dragging || e.pointerId !== aim.pointer) return;
    const p = toGround(e);
    if (!p) return;
    // Slingshot: pull back, the ball goes the other way.
    const dx = aim.start.x - p.x;
    const dy = aim.start.y - p.y;
    const d = Math.hypot(dx, dy);
    aim.power = Math.min(1, d / DRAG_FULL);
    if (d > 1) aim.angle = Math.atan2(dy, dx);
  }

  function onUp(e) {
    if (!aim.dragging || e.pointerId !== aim.pointer) return;
    onMove(e);
    aim.dragging = false;
    if (e.type === 'pointerup') shoot();
    if (aim.power < MIN_POWER) aim.power = 0.4;
  }

  return {
    mount(v, netRef, c) {
      view = v;
      ctx = v.ctx;
      net = netRef;
      input = c.input;
      sfx = c.sfx;
      core.mount(netRef, c);
      scene = v.glCanvas ? createGolfScene(v.glCanvas, { reducedMotion: c.reducedMotion }) : null;
      if (!scene) v.glCanvas?.remove();
      const canvas = v.canvas;
      canvas.classList.add('game-canvas--aim');
      const menu = (e) => e.preventDefault();
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', onUp);
      canvas.addEventListener('contextmenu', menu);
      cleanups.push(() => {
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onUp);
        canvas.removeEventListener('contextmenu', menu);
      });
    },

    onSnapshot(snap) {
      const prev = core.latest;
      const s = core.onSnapshot(snap);
      if (prev && s.hole !== prev.hole) {
        core.reset();
        pending = null;
      }
      scene?.setHole(s.hole);
    },

    onEvent(msg) {
      const slot = core.mySlot();
      switch (msg.e) {
        case 'go': sfx.play('go'); break;
        case 'hole': banner = null; aim.turnReady = false; break;
        case 'shot': if (msg.s !== slot) sfx.play('putt'); break;
        case 'wall': sfx.play('click'); break;
        case 'bumper': sfx.play('pop'); scene?.bumper(msg.x, msg.y); break;
        case 'splash':
          sfx.play('splash');
          scene?.splash(msg.x, msg.y);
          if (msg.s === slot) banner = { text: 'PLONS! +1 STRAFSLAG', color: '#6cc4ff', until: performance.now() + 1600 };
          break;
        case 'sink':
          sfx.play(msg.s === slot ? 'coin' : 'plop');
          scene?.sink(rgb(core.hex(msg.s)));
          if (msg.s === slot) {
            banner = msg.n === 1
              ? { text: 'HOLE-IN-ONE!', color: '#ffe14d', until: performance.now() + 2500 }
              : { text: `IN DE HOLE! ${msg.n} SLAGEN`, color: '#7cff6b', until: performance.now() + 2000 };
          }
          break;
        case 'out': if (msg.s === slot) sfx.play('error'); break;
        case 'roundEnd': sfx.play(msg.s === slot ? 'win' : 'countdown'); break;
        case 'end': sfx.play('win'); break;
        default: break;
      }
    },

    onReconnect() {
      core.reset();
      pending = null;
      aim.dragging = false;
    },

    update(dt) {
      scene?.update(dt);
      core.beep();
      const inp = input.sample();
      const a = (inp.buttons & BTN.A) !== 0;
      if (canAim()) {
        const me = core.mine();
        if (!aim.turnReady) {
          // New turn: point at the cup.
          const [cx, cy] = hole().cup;
          aim.angle = Math.atan2(cy - me.y, cx - me.x);
          aim.turnReady = true;
        }
        if (!aim.dragging) {
          const fine = (inp.buttons & BTN.B) !== 0;
          aim.angle += inp.ax * (fine ? FINE_TURN : TURN_SPEED) * dt;
          aim.power = Math.max(MIN_POWER, Math.min(1, aim.power - inp.ay * POWER_SPEED * dt));
          const rx = input.state.rx ?? 0;
          const ry = input.state.ry ?? 0;
          if (Math.hypot(rx, ry) > 0.5) aim.angle = Math.atan2(ry, rx);
          if (a && !prevA) shoot();
        }
      }
      prevA = a;
    },

    render() {
      ctx.clearRect(0, 0, view.width, view.height);
      const s = core.latest;
      if (!s) return;
      const sample = core.sample();
      const balls = [];
      if (sample) {
        const sa = sample.a.state;
        for (const eb of sample.b.state.ents) {
          const ea = core.find(sa.ents, eb.slot) ?? eb;
          const same = sa.hole === sample.b.state.hole;
          balls.push({
            slot: eb.slot, state: eb.state,
            x: same ? lerp(ea.x, eb.x, sample.t) : eb.x,
            y: same ? lerp(ea.y, eb.y, sample.t) : eb.y,
          });
        }
      }
      if (scene) {
        if (!scene.begin()) return;
        for (const b of balls) scene.ball(b.x, b.y, rgb(core.hex(b.slot)), b.state === BALL_STATE.SUNK);
        scene.endParticles();
      } else this.flat(s, balls);
      this.names(balls);
      if (canAim()) this.aimLine();
      this.hud(s);
    },

    // Screen position of a point on the course (3D or flat).
    screen(x, y, h) {
      if (scene) return scene.project(x, y, h, scratch);
      scratch.x = view.width / 2 + (x - FLAT.cx) * FLAT.s;
      scratch.y = view.height / 2 + 5 + (y - FLAT.cy) * FLAT.s;
      return scratch;
    },

    // Name tags above the balls; tags that would overlap move up a line.
    names(balls) {
      const mine = core.mySlot();
      placed.length = 0;
      for (const b of balls) {
        if (b.state === BALL_STATE.SUNK) continue;
        const p = this.screen(b.x, b.y, 7);
        if (!p) continue;
        const label = b.slot === mine ? 'JIJ' : core.name(b.slot).slice(0, 8);
        const x = Math.round(p.x);
        let y = Math.round(p.y) - 9;
        const half = label.length * 3 + 2;
        while (placed.some((q) => Math.abs(q.x - x) < q.half + half && Math.abs(q.y - y) < 9)) y -= 9;
        placed.push({ x, y, half });
        drawText(ctx, label, x, y, { color: b.slot === mine ? '#ffffff' : core.hex(b.slot), align: 'center', shadow: SHADOW });
      }
    },

    aimLine() {
      const me = core.mine();
      const color = core.hex(me.slot);
      const len = 10 + aim.power * 60;
      const dx = Math.cos(aim.angle);
      const dy = Math.sin(aim.angle);
      ctx.fillStyle = color;
      for (let d = 5; d <= len; d += 4) {
        const p = this.screen(me.x + dx * d, me.y + dy * d, 0.5);
        if (p) ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2);
      }
      const tip = this.screen(me.x + dx * (len + 3), me.y + dy * (len + 3), 0.5);
      if (tip) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(Math.round(tip.x) - 2, Math.round(tip.y) - 2, 4, 4);
      }
      // Power bar.
      const w = 120;
      const x = view.width / 2 - w / 2;
      const y = view.height - 26;
      ctx.fillStyle = 'rgba(11, 11, 30, 0.8)';
      ctx.fillRect(x - 2, y - 2, w + 4, 10);
      const pw = Math.round(w * aim.power);
      ctx.fillStyle = aim.power < 0.5 ? '#7cff6b' : aim.power < 0.8 ? '#ffe14d' : '#ff4d6d';
      ctx.fillRect(x, y, pw, 6);
      drawText(ctx, 'KRACHT', x - 6, y - 1, { color: '#ffffff', align: 'right', shadow: SHADOW });
      drawText(ctx, aim.dragging ? 'LAAT LOS OM TE SLAAN' : 'SLEEP TERUG EN LAAT LOS  /  PIJLTJES + SPATIE', view.width / 2, view.height - 12, { color: '#a3a8d6', align: 'center', shadow: SHADOW });
    },

    // Flat top-down view without WebGL.
    flat(s, balls) {
      const h = HOLES[s.hole];
      const X = (x) => view.width / 2 + (x - FLAT.cx) * FLAT.s;
      const Y = (y) => view.height / 2 + 5 + (y - FLAT.cy) * FLAT.s;
      const rect = (r, color) => { ctx.fillStyle = color; ctx.fillRect(X(r.x), Y(r.y), r.w * FLAT.s, r.h * FLAT.s); };
      ctx.fillStyle = '#120a2a';
      ctx.fillRect(0, 0, view.width, view.height);
      ctx.beginPath();
      h.outline.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      ctx.closePath();
      ctx.fillStyle = '#2f9e4f';
      ctx.fill();
      ctx.strokeStyle = '#3ef0ff';
      ctx.lineWidth = 2;
      ctx.stroke();
      for (const r of h.sand) rect(r, '#e6cf8e');
      for (const r of h.water) rect(r, '#1f7ae0');
      for (const r of h.blocks) rect(r, '#3a3190');
      for (const b of h.bumpers) {
        ctx.fillStyle = '#ff3ea5';
        ctx.beginPath();
        ctx.arc(X(b.x), Y(b.y), b.r * FLAT.s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#04040a';
      ctx.beginPath();
      ctx.arc(X(h.cup[0]), Y(h.cup[1]), CUP_R * FLAT.s, 0, Math.PI * 2);
      ctx.fill();
      for (const b of balls) {
        if (b.state === BALL_STATE.SUNK) continue;
        ctx.fillStyle = core.hex(b.slot);
        ctx.beginPath();
        ctx.arc(X(b.x), Y(b.y), 4, 0, Math.PI * 2);
        ctx.fill();
      }
    },

    hud(s) {
      const h = HOLES[s.hole];
      drawText(ctx, `HOLE ${s.holeNo + 1}/${s.holes}`, 6, 5, { color: '#ffffff', shadow: SHADOW });
      drawText(ctx, `${h.name}  PAR ${h.par}`, 6, 15, { color: '#3ef0ff', shadow: SHADOW });
      if (s.phase === ARCADE_PHASE.PLAY) {
        const left = Math.ceil(core.secondsLeft());
        drawText(ctx, `TIJD ${left}`, 6, 25, { color: left <= 10 ? '#ff4d6d' : '#a3a8d6', shadow: SHADOW });
      }
      // Scoreboard: this hole's strokes and the running total.
      const list = [...s.ents].sort((a, b) => runningTotal(a, s) - runningTotal(b, s));
      let y = 5;
      for (const e of list) {
        ctx.fillStyle = core.hex(e.slot);
        ctx.fillRect(view.width - 104, y, 5, 7);
        drawText(ctx, core.name(e.slot).slice(0, 8), view.width - 96, y, { color: '#ffffff', shadow: SHADOW });
        const now = e.state === BALL_STATE.SUNK ? 'IN' : e.state === BALL_STATE.OUT ? 'X' : String(e.strokes);
        const nowColor = e.state === BALL_STATE.SUNK ? '#7cff6b' : e.state === BALL_STATE.OUT ? '#ff4d6d' : '#a3a8d6';
        drawText(ctx, now, view.width - 30, y, { color: nowColor, align: 'right', shadow: SHADOW });
        drawText(ctx, String(runningTotal(e, s)), view.width - 6, y, { color: '#ffe14d', align: 'right', shadow: SHADOW });
        y += 11;
      }

      const me = core.mine();
      if (s.phase === ARCADE_PHASE.COUNTDOWN) {
        drawText(ctx, h.name, view.width / 2, 70, { color: '#ffffff', scale: 3, align: 'center', shadow: '#ff3ea5' });
        drawText(ctx, `PAR ${h.par}`, view.width / 2, 98, { color: '#3ef0ff', scale: 2, align: 'center', shadow: SHADOW });
        drawText(ctx, String(Math.max(1, Math.ceil(core.secondsLeft()))), view.width / 2, 130, { color: '#ffe14d', scale: 5, align: 'center', shadow: '#ff3ea5' });
      } else if (s.phase === ARCADE_PHASE.ROUND_END || s.phase === ARCADE_PHASE.END) {
        this.scorecard(s);
      } else if (banner && performance.now() < banner.until) {
        drawText(ctx, banner.text, view.width / 2, 40, { color: banner.color, scale: 2, align: 'center', shadow: SHADOW });
      } else if (me && (me.state === BALL_STATE.SUNK || me.state === BALL_STATE.OUT)) {
        drawText(ctx, 'WACHTEN OP DE ANDEREN...', view.width / 2, view.height - 14, { color: '#a3a8d6', align: 'center', shadow: SHADOW });
      }
    },

    // Score card between holes: one column per hole, total at the end.
    scorecard(s) {
      const played = s.holeNo + 1;
      const colW = 18;
      const nameW = 64;
      const w = nameW + played * colW + 34;
      const rows = [...s.ents].sort((a, b) => runningTotal(a, s) - runningTotal(b, s));
      const hgt = 26 + rows.length * 11;
      const x0 = Math.round(view.width / 2 - w / 2);
      const y0 = Math.round(view.height / 2 - hgt / 2);
      ctx.fillStyle = 'rgba(11, 8, 30, 0.88)';
      ctx.fillRect(x0 - 6, y0 - 6, w + 12, hgt + 12);
      ctx.fillStyle = '#ff3ea5';
      ctx.fillRect(x0 - 6, y0 - 6, w + 12, 1);
      drawText(ctx, s.phase === ARCADE_PHASE.END ? 'EINDSTAND' : 'SCOREKAART', x0, y0, { color: '#ffe14d', shadow: SHADOW });
      drawText(ctx, 'TOT', x0 + w, y0 + 12, { color: '#a3a8d6', align: 'right' });
      for (let i = 0; i < played; i++) {
        drawText(ctx, String(i + 1), x0 + nameW + i * colW + colW / 2, y0 + 12, { color: '#a3a8d6', align: 'center' });
      }
      rows.forEach((e, r) => {
        const y = y0 + 24 + r * 11;
        drawText(ctx, core.name(e.slot).slice(0, 9), x0, y, { color: core.hex(e.slot) });
        for (let i = 0; i < played; i++) {
          const v = e.scores[i];
          if (v === undefined) continue;
          drawText(ctx, String(v), x0 + nameW + i * colW + colW / 2, y, { color: v === 1 ? '#ffe14d' : '#ffffff', align: 'center' });
        }
        drawText(ctx, String(runningTotal(e, s)), x0 + w, y, { color: '#ffe14d', align: 'right' });
      });
      const hint = s.phase === ARCADE_PHASE.END ? '' : `VOLGENDE HOLE OVER ${Math.ceil(core.secondsLeft())}`;
      if (hint) drawText(ctx, hint, view.width / 2, y0 + hgt + 10, { color: '#a3a8d6', align: 'center', shadow: SHADOW });
    },

    unmount() {
      for (const fn of cleanups) fn();
      scene?.destroy();
    },
  };
}

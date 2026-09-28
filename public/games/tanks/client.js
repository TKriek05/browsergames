// Tank Tumult (client side): your tank is predicted with the shared physics,
// everything else is interpolated. Aim with the mouse, the right stick, or
// let auto-aim pick the nearest enemy in front of you (keys / touch).
import { PLAYER_COLORS } from '../../../shared/constants.js';
import { BTN } from '../../../shared/messages.js';
import { ByteWriter, encodeInput, quantizeAxis } from '../../../shared/binary.js';
import { stepTank, lineOfSight, TANK_PHYS } from '../../../shared/physics/tanks.js';
import { TANK_ARENAS, TILE } from '../../../shared/maps/tank-arenas.js';
import { TANK_PHASE, TANK_MODE, TANK_RULES, POWERUPS, TANK_FLAG, i16ToAim } from '../../../shared/games/tanks.js';
import { SnapshotBuffer, lerp } from '../../js/core/interp.js';
import { Predictor } from '../../js/core/predict.js';
import { rgb } from '../../js/gl/mesh.js';
import { createTankScene } from './scene.js';
import { createTankHud, createFallback2D } from './hud.js';

export const meta = {
  width: 480,
  height: 270,
  pixelated: true,
  gl: true,
  step: TANK_PHYS.DT,
  touchButtons: [{ label: 'VUUR', bit: BTN.A }],
};

const MOUSE_IDLE_MS = 4000; // after this, keyboard players get auto-aim again
const AUTO_AIM_COS = Math.cos((75 * Math.PI) / 180);

function decode(snap) {
  const r = snap.reader;
  const s = { time: snap.time, phase: r.u8(), mode: r.u8(), endsAt: 0, round: 0, tanks: [], bullets: [], crates: [], pickups: [] };
  s.endsAt = snap.time + r.f32() * 1000;
  s.round = r.u8();
  const n = r.u8();
  for (let i = 0; i < n; i++) {
    const slot = r.u8();
    const flags = r.u8();
    s.tanks.push({
      slot, flags,
      alive: (flags & TANK_FLAG.ALIVE) !== 0,
      connected: (flags & TANK_FLAG.CONNECTED) !== 0,
      ack: r.u16(),
      x: r.f32(), y: r.f32(), dx: r.f32(), dy: r.f32(), v: r.f32(), boost: r.f32(),
      aim: i16ToAim(r.i16()), hp: r.u8(), kills: r.i16(), deaths: r.u8(), wins: r.u8(),
      respawn: r.u8() / 10, power: r.u8() / 10,
    });
  }
  const nb = r.u8();
  for (let i = 0; i < nb; i++) s.bullets.push({ id: r.u16(), owner: r.u8(), x: r.i16() / 8, y: r.i16() / 8 });
  const nc = r.u8();
  for (let i = 0; i < nc; i++) s.crates.push(r.u8());
  const np = r.u8();
  for (let i = 0; i < np; i++) s.pickups.push({ x: r.i16(), y: r.i16(), type: r.u8() });
  return s;
}

const find = (list, slot) => {
  for (let i = 0; i < list.length; i++) if (list[i].slot === slot) return list[i];
  return null;
};
const lerpAngle = (a, b, t) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

export function createGame() {
  let net, session, input, sfx, view, scene, hud, flat;
  let arena;
  let tiles;
  let latest = null;
  let lastCountdown = 0;
  let banner = null; // { text, sub, color, until }
  const buffer = new SnapshotBuffer();
  const writer = new ByteWriter(16);
  const sendInput = { ax: 0, ay: 0, buttons: 0, aim: 0 };
  const serverState = { x: 0, y: 0, dx: 1, dy: 0, v: 0, boost: 0 };
  const mouse = { x: 0, y: 0, at: 0, down: false };
  const recoil = new Map(); // slot → 0..1
  const scratch = { x: 0, y: 0, depth: 0 };
  const worldPt = { x: 0, y: 0, z: 0 };
  const cleanups = [];
  let myAim = 0;
  let localCooldown = 0;
  let lastFrame = 0;

  const predictor = new Predictor({
    create: () => ({ x: 0, y: 0, dx: 1, dy: 0, v: 0, boost: 0 }),
    copy: (d, s) => { d.x = s.x; d.y = s.y; d.dx = s.dx; d.dy = s.dy; d.v = s.v; d.boost = s.boost; },
    step: (s, inp) => stepTank(s, inp.ax, inp.ay, TANK_PHYS.DT, tiles),
  });

  const mySlot = () => {
    const me = session.myPlayer;
    return me && me.role === 'player' ? me.slot : -1;
  };
  const playerBySlot = (slot) => session.room?.players.find((p) => p.slot === slot) ?? null;
  const hexOf = (slot) => PLAYER_COLORS[playerBySlot(slot)?.color ?? slot % PLAYER_COLORS.length].hex;
  const myTank = () => (latest ? find(latest.tanks, mySlot()) : null);
  const iAmAlive = () => {
    const t = myTank();
    return !!t && t.alive;
  };

  // Keep the local tile grid (crates) in sync for prediction and auto-aim.
  function syncCrates(hp) {
    arena.crates.forEach((idx, i) => { tiles[idx] = hp[i] > 0 ? TILE.CRATE : TILE.FLOOR; });
    scene?.setCrates(hp);
  }

  function chooseAim(inp) {
    const s = predictor.state;
    if (Math.hypot(inp.rx, inp.ry) > 0.3) return Math.atan2(inp.ry, inp.rx);
    if (performance.now() - mouse.at < MOUSE_IDLE_MS) {
      const p = scene ? scene.ground(mouse.x, mouse.y, worldPt) : flat.toWorld(mouse.x, mouse.y, worldPt);
      if (p) return Math.atan2(p.y - s.y, p.x - s.x);
    }
    // Auto-aim: nearest visible enemy in front of the hull.
    let best = null;
    let bestD = Infinity;
    for (const t of latest?.tanks ?? []) {
      if (t.slot === mySlot() || !t.alive) continue;
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const d = Math.hypot(dx, dy);
      if (d < 1 || d > 260 || (dx * s.dx + dy * s.dy) / d < AUTO_AIM_COS) continue;
      if (d < bestD && lineOfSight(tiles, s.x, s.y, t.x, t.y)) { bestD = d; best = t; }
    }
    if (best) return Math.atan2(best.y - s.y, best.x - s.x);
    return Math.atan2(s.dy, s.dx);
  }

  return {
    mount(v, netRef, ctx) {
      view = v;
      net = netRef;
      session = ctx.session;
      input = ctx.input;
      sfx = ctx.sfx;
      arena = TANK_ARENAS[ctx.start.settings.arena] ?? TANK_ARENAS.kruispunt;
      tiles = arena.tiles.slice();
      hud = createTankHud(view);
      scene = view.glCanvas ? createTankScene(view.glCanvas, { arena, reducedMotion: ctx.reducedMotion }) : null;
      if (!scene) {
        view.glCanvas?.remove();
        flat = createFallback2D(view, arena);
      }
      const canvas = view.canvas;
      canvas.classList.add('game-canvas--aim');
      const move = (e) => {
        if (e.pointerType === 'touch') return;
        const p = view.toLogical(e.clientX, e.clientY);
        mouse.x = p.x;
        mouse.y = p.y;
        mouse.at = performance.now();
      };
      const down = (e) => {
        if (e.pointerType === 'touch') return;
        move(e);
        if (e.button === 0) mouse.down = true;
      };
      const up = () => { mouse.down = false; };
      const menu = (e) => e.preventDefault();
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerdown', down);
      window.addEventListener('pointerup', up);
      canvas.addEventListener('contextmenu', menu);
      cleanups.push(() => {
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerdown', down);
        window.removeEventListener('pointerup', up);
        canvas.removeEventListener('contextmenu', menu);
      });
    },

    onSnapshot(snap) {
      const s = decode(snap);
      if (latest && s.round !== latest.round) buffer.clear();
      latest = s;
      buffer.push(s.time, s);
      syncCrates(s.crates);
      const mine = find(s.tanks, mySlot());
      if (mine) {
        serverState.x = mine.x;
        serverState.y = mine.y;
        serverState.dx = mine.dx;
        serverState.dy = mine.dy;
        serverState.v = mine.v;
        serverState.boost = mine.boost;
        predictor.reconcile(serverState, mine.ack);
      }
    },

    onEvent(msg) {
      const slot = mySlot();
      const color = msg.s !== undefined ? hexOf(msg.s) : '#ffffff';
      switch (msg.e) {
        case 'go': sfx.play('go'); break;
        case 'fire':
          if (msg.s !== slot) {
            recoil.set(msg.s, 1);
            sfx.play('gunFar');
          }
          break;
        case 'bounce': scene?.sparks(msg.x, msg.y, '#3ef0ff', 5); sfx.play('click'); break;
        case 'spark': scene?.sparks(msg.x, msg.y); break;
        case 'hit':
          scene?.sparks(msg.x, msg.y, '#ff9a3e', 14);
          sfx.play('hit');
          if (msg.s === slot) scene?.shake(5);
          break;
        case 'shieldHit': scene?.sparks(msg.x, msg.y, '#c77dff', 12); sfx.play('react'); break;
        case 'boom':
          scene?.explosion(msg.x, msg.y, rgb(color));
          sfx.play('explode');
          if (msg.s === slot) banner = { text: 'KAPOT!', sub: msg.by >= 0 && msg.by !== slot ? `door ${playerBySlot(msg.by)?.name ?? '?'}` : '', color: '#ff4d6d', until: performance.now() + 1500 };
          else if (msg.by === slot) banner = { text: 'RAAK!', sub: `${playerBySlot(msg.s)?.name ?? '?'} is uitgeschakeld`, color: '#5dff8a', until: performance.now() + 1200 };
          break;
        case 'crate':
          scene?.particles.burst(msg.x, 6, msg.y, '#b8742a', 18, { speed: 40, life: 0.8, size: 2.5, gravity: -60, up: 0.8 });
          sfx.play('thud');
          break;
        case 'pickup':
          sfx.play('coin');
          if (msg.s === slot) banner = { text: POWERUPS[msg.type].name.toUpperCase(), sub: '', color: POWERUPS[msg.type].color, until: performance.now() + 1000 };
          break;
        case 'spawn': if (msg.s === slot) sfx.play('join'); break;
        case 'round': buffer.clear(); predictor.reset(); banner = null; break;
        case 'roundEnd': {
          const name = msg.s >= 0 ? playerBySlot(msg.s)?.name ?? '?' : 'Niemand';
          banner = { text: msg.s === slot ? 'RONDE GEWONNEN!' : `${name.toUpperCase()} WINT`, sub: 'de ronde', color: msg.s >= 0 ? hexOf(msg.s) : '#ffffff', until: performance.now() + 3000 };
          sfx.play(msg.s === slot ? 'win' : 'countdown');
          break;
        }
        case 'end': sfx.play('win'); break;
        default: break;
      }
    },

    onReconnect() {
      predictor.reset();
      buffer.clear();
    },

    update(dt) {
      scene?.update(dt);
      for (const [k, v] of recoil) recoil.set(k, Math.max(0, v - dt * 5));
      localCooldown = Math.max(0, localCooldown - dt);
      const inp = input.sample();
      const playing = latest && latest.phase === TANK_PHASE.PLAY && mySlot() >= 0 && predictor.ready && iAmAlive();
      if (playing) {
        myAim = chooseAim(inp);
        sendInput.ax = quantizeAxis(inp.ax);
        sendInput.ay = quantizeAxis(inp.ay);
        sendInput.buttons = inp.buttons | (mouse.down ? BTN.A : 0);
        sendInput.aim = myAim;
        const seq = predictor.apply(sendInput);
        net.sendBinary(encodeInput(writer, seq, sendInput));
        if (sendInput.buttons & BTN.A && localCooldown <= 0) {
          // Predicted muzzle flash: the bullet itself comes with the next snapshot.
          localCooldown = TANK_RULES.FIRE_COOLDOWN_S;
          recoil.set(mySlot(), 1);
          sfx.play('shoot');
          const s = predictor.state;
          scene?.sparks(s.x + Math.cos(myAim) * 11, s.y + Math.sin(myAim) * 11, '#ffe14d', 6);
        }
      } else {
        predictor.idle();
      }
      if (latest?.phase === TANK_PHASE.COUNTDOWN) {
        const left = Math.ceil((latest.endsAt - net.serverNow()) / 1000);
        if (left > 0 && left !== lastCountdown) sfx.play('countdown');
        lastCountdown = left;
      }
    },

    render(alpha) {
      hud.clear();
      const frameNow = performance.now();
      const frameDt = lastFrame ? Math.min(0.1, (frameNow - lastFrame) / 1000) : 0;
      lastFrame = frameNow;
      if (scene) {
        const follow = predictor.ready && iAmAlive() ? { x: predictor.get('x', alpha), y: predictor.get('y', alpha) } : null;
        if (!scene.begin(follow, frameDt)) return;
      } else {
        flat.begin(tiles);
      }
      if (!latest) return;
      const now = net.serverNow();
      const sample = buffer.sample(now);
      const slot = mySlot();
      const labels = [];
      const shadows = [];
      if (sample) {
        const a = sample.a.state;
        const b = sample.b.state;
        for (const tb of b.tanks) {
          const ta = find(a.tanks, tb.slot) ?? tb;
          const me = tb.slot === slot && predictor.ready && tb.alive;
          let x, y, dx, dy, aim;
          if (me) {
            x = predictor.get('x', alpha);
            y = predictor.get('y', alpha);
            dx = predictor.state.dx;
            dy = predictor.state.dy;
            aim = myAim;
          } else {
            x = lerp(ta.x, tb.x, sample.t);
            y = lerp(ta.y, tb.y, sample.t);
            dx = lerp(ta.dx, tb.dx, sample.t);
            dy = lerp(ta.dy, tb.dy, sample.t);
            aim = lerpAngle(ta.aim, tb.aim, sample.t);
          }
          const hex = hexOf(tb.slot);
          const alive = latest ? (find(latest.tanks, tb.slot)?.alive ?? tb.alive) : tb.alive;
          if (scene) {
            if (alive) {
              scene.tank(x, y, dx, dy, aim, rgb(hex), { recoil: recoil.get(tb.slot) ?? 0 });
              shadows.push([x, y, (tb.flags & TANK_FLAG.SHIELD) !== 0, hex]);
            } else scene.wreck(x, y, dx, dy);
          } else flat.tank(x, y, dx, dy, aim, hex, alive);
          if (alive) labels.push([x, y, tb.slot, tb.hp]);
        }
        for (const bb of b.bullets) {
          let ba = null;
          for (const q of a.bullets) if (q.id === bb.id) { ba = q; break; }
          const x = ba ? lerp(ba.x, bb.x, sample.t) : bb.x;
          const y = ba ? lerp(ba.y, bb.y, sample.t) : bb.y;
          if (scene) scene.bullet(x, y, rgb(hexOf(bb.owner)));
          else flat.bullet(x, y, hexOf(bb.owner));
        }
      }
      for (const p of latest.pickups) (scene ?? flat).pickup(p.x, p.y, p.type);
      if (scene) {
        for (const [x, y, shielded, hex] of shadows) {
          scene.shadow(x, y);
          if (shielded) scene.shield(x, y, rgb(hex));
        }
        scene.endParticles();
      }

      // --- HUD ---
      for (const [x, y, s, hp] of labels) {
        const p = scene ? scene.project(x, y, 16, scratch) : flat.toScreen(x, y - 14, scratch);
        if (p) hud.label(p.x, p.y, playerBySlot(s)?.name ?? '?', hexOf(s), hp, s === slot);
      }
      const rounds = latest.mode === TANK_MODE.ROUNDS;
      hud.scoreboard(
        [...latest.tanks]
          .sort((p, q) => (rounds ? q.wins - p.wins : 0) || q.kills - p.kills)
          .map((t) => ({ name: playerBySlot(t.slot)?.name ?? '?', color: hexOf(t.slot), kills: t.kills, wins: t.wins, alive: t.alive, me: t.slot === slot })),
        rounds,
      );
      const left = Math.max(0, latest.endsAt - now) / 1000;
      if (latest.phase === TANK_PHASE.PLAY && !rounds) hud.timer(`${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`);
      if (rounds) hud.timer(`RONDE ${latest.round}`);

      const mine = myTank();
      if (mine) {
        const powers = [];
        if (mine.flags & TANK_FLAG.SHIELD) powers.push(POWERUPS[3]);
        if (mine.flags & TANK_FLAG.TRIPLE) powers.push(POWERUPS[1]);
        if (mine.flags & TANK_FLAG.BOUNCE) powers.push(POWERUPS[4]);
        if (mine.boost > 0) powers.push(POWERUPS[2]);
        hud.status({ hp: mine.alive ? mine.hp : 0, powers: powers.map((p) => ({ name: p.name, color: p.color, left: mine.power, max: p.seconds })) });
      }

      if (latest.phase === TANK_PHASE.COUNTDOWN) hud.center(String(Math.max(1, Math.ceil(left))), rounds ? `RONDE ${latest.round}: WIE BLIJFT OVER?` : 'SCHIET ZE KAPOT!');
      else if (latest.phase === TANK_PHASE.END) hud.center('EINDE!', '');
      else if (mine && !mine.alive && latest.phase === TANK_PHASE.PLAY) {
        hud.center(rounds ? 'UITGESCHAKELD' : `TERUG IN ${Math.max(1, Math.ceil(mine.respawn))}`, rounds ? 'wacht op de volgende ronde' : '', '#ff4d6d');
      } else if (banner && performance.now() < banner.until) hud.center(banner.text, banner.sub, banner.color);
      else if (slot < 0) hud.center('', 'JE KIJKT MEE');

      if (performance.now() - mouse.at < MOUSE_IDLE_MS && iAmAlive()) hud.crosshair(mouse.x, mouse.y, hexOf(slot));
    },

    unmount() {
      for (const fn of cleanups) fn();
      scene?.destroy();
      buffer.clear();
    },
  };
}

// Spetterveld (client side): first-person paintball. You are predicted with
// the shared physics; the others are interpolated. Mouse look via pointer
// lock (click the field), WASD to walk, click/space to shoot. Touch: stick on
// the left, drag on the right to look. Your shots show at once; the server
// decides what they hit (lag compensated) and tells everyone.
import { INTERP_DELAY_MS } from '../../../shared/constants.js';
import { BTN, C2S } from '../../../shared/messages.js';
import { PB_ARENAS } from '../../../shared/maps/paintball-arenas.js';
import { PB_PHYS, stepRunner, raycast, rayCircle, lineOfSight } from '../../../shared/physics/paintball.js';
import { PB_RULES as R, PB_FLAG, i16ToYaw, wrapAngle } from '../../../shared/games/paintball.js';
import { createArcadeCore, ARCADE_PHASE } from '../common/arcade.js';
import { Predictor } from '../../js/core/predict.js';
import { isTouchDevice } from '../../js/core/input.js';
import { rgb } from '../../js/gl/mesh.js';
import { createPaintScene } from './scene.js';
import { createPaintHud, createFallback2D } from './hud.js';

export const meta = {
  width: 480,
  height: 270,
  pixelated: false,
  gl: true,
  step: PB_PHYS.DT,
  touchButtons: [{ label: 'LAAD', bit: BTN.B }, { label: 'VUUR', bit: BTN.A }],
  keys: {
    up: ['KeyW', 'ArrowUp'],
    down: ['KeyS', 'ArrowDown'],
    left: ['KeyA'],
    right: ['KeyD'],
    A: ['Space', 'KeyJ', 'Enter'],
    B: ['KeyR'],
    turnLeft: ['ArrowLeft', 'KeyQ'],
    turnRight: ['ArrowRight', 'KeyE'],
  },
};

const MOUSE_SENS = 0.0026; // rad per pixel
const TOUCH_SENS = 0.007;
const KEY_TURN = 2.6; // rad/s
const PAD_TURN = 3.4;
const ASSIST_RAD = 0.085; // touch/gamepad: shots snap to a player this close to the crosshair
const FEED_S = 6;

function decode(r, time) {
  const s = { time, phase: r.u8(), endsAt: 0, ents: [] };
  s.endsAt = time + r.f32() * 1000;
  const n = r.u8();
  for (let i = 0; i < n; i++) {
    const slot = r.u8();
    const flags = r.u8();
    s.ents.push({
      slot, flags, ack: r.u16(),
      x: r.f32(), y: r.f32(), vx: r.f32(), vy: r.f32(), yaw: i16ToYaw(r.i16()),
      hp: r.u8(), ammo: r.u8(), kills: r.i16(), deaths: r.u8(), respawn: r.u8() / 10, reload: r.u8() / 10,
      alive: (flags & PB_FLAG.ALIVE) !== 0,
    });
  }
  return s;
}

const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;

export function createGame() {
  let net, session, input, sfx, view, scene, hud, flat, arena, reduced;
  let yaw = 0;
  let syncYaw = true;
  let locked = false;
  let lockFailed = false;
  let mouseFire = false;
  let touch = false;
  let lookId = null;
  let lookX = 0;
  let ammo = R.HOPPER;
  let reload = 0;
  let cooldown = 0;
  let lastShotAt = 0;
  let hitAt = -10;
  let deathAt = 0;
  let killer = '';
  let banner = null;
  let walkMe = 0;
  let lastFrame = 0;
  let wasAlive = false;
  const feed = []; // { by, byColor, victim, victimColor, at }
  const walk = new Map(); // slot → walk phase
  const shownYaw = new Map(); // slot → smoothed body angle
  const drawn = new Map(); // slot → { x, y } where others were drawn (for local hit tests)
  const scratch = { x: 0, y: 0, depth: 0 };
  const ray = { nx: 0, ny: 0, obstacle: -1 };
  const cleanups = [];

  const predictor = new Predictor({
    create: () => ({ x: 0, y: 0, vx: 0, vy: 0 }),
    copy: (d, s) => { d.x = s.x; d.y = s.y; d.vx = s.vx; d.vy = s.vy; },
    step: (s, inp) => stepRunner(s, inp.ax, inp.ay, PB_PHYS.DT, arena.obstacles),
  });
  const core = createArcadeCore({
    decode,
    predictor,
    toServer: (m, o) => { o.x = m.x; o.y = m.y; o.vx = m.vx; o.vy = m.vy; },
  });
  const nowS = () => performance.now() / 1000;

  function startReload() {
    if (reload > 0 || ammo >= R.HOPPER) return;
    reload = R.RELOAD_S;
    sfx.play('reload');
  }

  // Touch and gamepad players get a little help: aim at a visible player right next to the crosshair.
  function assisted(a, px, py) {
    if (input.lastSource === 'keyboard' || locked) return a;
    let best = a;
    let bestD = ASSIST_RAD;
    for (const [, p] of drawn) {
      const d = Math.abs(wrapAngle(Math.atan2(p.y - py, p.x - px) - a));
      if (d < bestD && Math.hypot(p.x - px, p.y - py) < 260 && lineOfSight(arena.obstacles, px, py, p.x, p.y)) {
        bestD = d;
        best = Math.atan2(p.y - py, p.x - px);
      }
    }
    return best;
  }

  function fire() {
    if (cooldown > 0 || reload > 0) return;
    if (ammo <= 0) return startReload();
    cooldown = R.COOLDOWN_S;
    ammo--;
    lastShotAt = nowS();
    const px = predictor.state.x;
    const py = predictor.state.y;
    const a = assisted(yaw, px, py);
    net.send(C2S.INPUT, { data: { a, t: net.serverNow() - INTERP_DELAY_MS, x: Math.round(px * 100) / 100, y: Math.round(py * 100) / 100 } });
    // Show the ball right away: it stops at the first wall or player we see.
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let end = raycast(arena.obstacles, px, py, dx, dy, R.RANGE, ray);
    let wall = ray.obstacle >= 0;
    for (const [, p] of drawn) {
      const d = rayCircle(px, py, dx, dy, p.x, p.y, PB_PHYS.HIT_RADIUS);
      if (d < end) { end = d; wall = false; }
    }
    scene?.ball(px + dx * 4, py + dy * 4, px + dx * end, py + dy * end, core.hex(core.mySlot()), wall, ray.nx, ray.ny);
    scene?.kick();
    sfx.play('marker');
    if (ammo === 0) startReload();
  }

  // Keep the local hopper in step with the server when we are not shooting.
  function syncAmmo(mine) {
    if (nowS() - lastShotAt < 0.6) return;
    const serverReloading = (mine.flags & PB_FLAG.RELOAD) !== 0;
    if (serverReloading && reload <= 0) reload = mine.reload;
    else if (!serverReloading) {
      if (reload > 0 && mine.ammo === R.HOPPER) reload = 0;
      if (reload <= 0) ammo = mine.ammo;
    }
  }

  function bindControls(canvas) {
    const onClick = () => {
      if (touch || locked || lockFailed) return;
      try {
        const p = canvas.requestPointerLock?.();
        p?.catch?.(() => { lockFailed = true; });
      } catch {
        lockFailed = true;
      }
    };
    const onLockChange = () => {
      locked = document.pointerLockElement === canvas;
      if (!locked) mouseFire = false;
    };
    const onLockError = () => { lockFailed = true; };
    const onMove = (e) => {
      if (locked) yaw = wrapAngle(yaw + e.movementX * MOUSE_SENS);
      else if (lockFailed && e.buttons & 1 && e.pointerType === 'mouse') yaw = wrapAngle(yaw + e.movementX * MOUSE_SENS);
    };
    const onDown = (e) => {
      if (e.pointerType === 'touch') {
        if (lookId === null) {
          lookId = e.pointerId;
          lookX = e.clientX;
        }
        return;
      }
      if (e.button === 0 && (locked || lockFailed)) mouseFire = true;
    };
    const onTouchMove = (e) => {
      if (e.pointerId !== lookId) return;
      yaw = wrapAngle(yaw + (e.clientX - lookX) * TOUCH_SENS);
      lookX = e.clientX;
    };
    const onUp = (e) => {
      if (e.pointerId === lookId) lookId = null;
      if (e.pointerType !== 'touch' && e.button === 0) mouseFire = false;
    };
    const menu = (e) => e.preventDefault();
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onTouchMove);
    canvas.addEventListener('contextmenu', menu);
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('pointerlockerror', onLockError);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    cleanups.push(() => {
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onTouchMove);
      canvas.removeEventListener('contextmenu', menu);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('pointerlockerror', onLockError);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    });
  }

  return {
    mount(v, netRef, ctx) {
      view = v;
      net = netRef;
      session = ctx.session;
      input = ctx.input;
      sfx = ctx.sfx;
      reduced = ctx.reducedMotion;
      touch = isTouchDevice();
      core.mount(netRef, ctx);
      arena = PB_ARENAS[ctx.start.settings.arena] ?? PB_ARENAS.opblaas;
      hud = createPaintHud(view);
      scene = view.glCanvas ? createPaintScene(view.glCanvas, { arena, reducedMotion: reduced }) : null;
      if (!scene) {
        view.glCanvas?.remove();
        flat = createFallback2D(view, arena);
      }
      view.canvas.style.touchAction = 'none';
      bindControls(view.canvas);
    },

    onSnapshot(snap) {
      core.onSnapshot(snap);
      const mine = core.mine();
      if (mine) syncAmmo(mine);
    },

    onEvent(msg) {
      const me = core.mySlot();
      switch (msg.e) {
        case 'go': sfx.play('go'); break;
        case 'shot': {
          if (msg.s === me) break; // already shown when we fired
          const dx = msg.x1 - msg.x0;
          const dy = msg.y1 - msg.y0;
          const len = Math.hypot(dx, dy) || 1;
          let wall = false;
          if (msg.h < 0) {
            raycast(arena.obstacles, msg.x0, msg.y0, dx / len, dy / len, len + 1, ray);
            wall = ray.obstacle >= 0;
          }
          scene?.ball(msg.x0 + (dx / len) * 4, msg.y0 + (dy / len) * 4, msg.x1, msg.y1, core.hex(msg.s), wall, ray.nx, ray.ny);
          scene?.muzzle(msg.x0, msg.y0, Math.atan2(dy, dx), core.hex(msg.s));
          sfx.play('markerFar');
          break;
        }
        case 'hit': {
          const p = drawn.get(msg.s);
          if (p) scene?.paintHit(p.x, p.y, core.hex(msg.by), false);
          if (msg.s === me) {
            hud.splash(core.hex(msg.by));
            sfx.play('hit');
          } else if (msg.by === me) {
            hitAt = nowS();
            sfx.play('splat');
          }
          break;
        }
        case 'splat': {
          scene?.paintHit(msg.x, msg.y, core.hex(msg.by), true);
          feed.unshift({ by: core.name(msg.by), byColor: core.hex(msg.by), victim: core.name(msg.s), victimColor: core.hex(msg.s), at: nowS() });
          feed.length = Math.min(feed.length, 4);
          if (msg.s === me) {
            deathAt = nowS();
            killer = core.name(msg.by);
            hud.splash(core.hex(msg.by));
            hud.splash(core.hex(msg.by));
            sfx.play('lose');
          } else if (msg.by === me) {
            banner = { text: 'SPETTER!', sub: `${core.name(msg.s)} is uitgeschakeld`, color: '#ffe14d', until: nowS() + 1.4 };
            sfx.play('coin');
          }
          break;
        }
        case 'block': sfx.play('react'); break;
        case 'spawn':
          if (msg.s === me) {
            predictor.reset();
            syncYaw = true;
            ammo = R.HOPPER;
            reload = 0;
            sfx.play('join');
          }
          break;
        case 'reload':
          if (msg.s === me && reload <= 0 && ammo < R.HOPPER) reload = R.RELOAD_S;
          break;
        case 'end': sfx.play('win'); break;
        default: break;
      }
    },

    onReconnect() {
      core.reset();
      syncYaw = true;
    },

    update(dt) {
      scene?.update(dt);
      core.beep();
      cooldown = Math.max(0, cooldown - dt);
      if (reload > 0) {
        reload -= dt;
        if (reload <= 0) {
          reload = 0;
          ammo = R.HOPPER;
        }
      }
      const L = core.latest;
      const mine = core.mine();
      const alive = !!mine && mine.alive;
      if (alive && !wasAlive) syncYaw = true;
      wasAlive = alive;
      if (syncYaw && alive) {
        yaw = mine.yaw;
        syncYaw = false;
      }
      if (!L || !mine || !alive) {
        core.idle();
        return;
      }
      const inp = input.sample();
      const turn = (input.pressed('turnRight') ? 1 : 0) - (input.pressed('turnLeft') ? 1 : 0);
      yaw = wrapAngle(yaw + turn * KEY_TURN * dt + inp.rx * PAD_TURN * dt);
      if (L.phase !== ARCADE_PHASE.PLAY || !predictor.ready) {
        core.idle();
        return;
      }
      const fwd = -inp.ay;
      const side = inp.ax;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      let wx = c * fwd - s * side;
      let wy = s * fwd + c * side;
      const len = Math.hypot(wx, wy);
      if (len > 1) { wx /= len; wy /= len; }
      core.send(wx, wy, inp.buttons & BTN.B, yaw);
      if (inp.buttons & BTN.B) startReload();
      if (inp.buttons & BTN.A || mouseFire) fire();
    },

    render(alpha) {
      hud.clear();
      const frameNow = performance.now();
      const frameDt = lastFrame ? Math.min(0.1, (frameNow - lastFrame) / 1000) : 0;
      lastFrame = frameNow;
      const L = core.latest;
      const me = core.mySlot();
      const mine = core.mine();
      const alive = !!mine && mine.alive && predictor.ready;
      const px = alive ? predictor.get('x', alpha) : mine?.x ?? 210;
      const py = alive ? predictor.get('y', alpha) : mine?.y ?? 140;
      const speed = alive ? Math.hypot(predictor.state.vx, predictor.state.vy) : 0;
      walkMe += speed * frameDt * 0.2;
      const bob = alive && !reduced ? Math.sin(walkMe * 2) * 0.28 * Math.min(1, speed / PB_PHYS.SPEED) : 0;
      const dead = mine && !mine.alive ? Math.max(0.01, nowS() - deathAt) : 0;
      if (scene) {
        if (!scene.begin({ x: px, y: py, yaw, bob, dead, overview: me < 0 || !L })) return;
      } else flat.begin();
      if (!L) {
        scene?.endWorld();
        return;
      }

      const sample = core.sample();
      const labels = [];
      const shields = [];
      drawn.clear();
      core.each(sample, 'ents', 'slot', (eb, x, y) => {
        if (!eb.alive) return;
        const hex = core.hex(eb.slot);
        if (eb.slot === me) {
          if (!scene) flat.player(px, py, yaw, hex, true);
          return;
        }
        const sy = lerpAngle(shownYaw.get(eb.slot) ?? eb.yaw, eb.yaw, Math.min(1, frameDt * 14));
        shownYaw.set(eb.slot, sy);
        const sp = Math.hypot(eb.vx, eb.vy);
        const w = (walk.get(eb.slot) ?? 0) + sp * frameDt * 0.2;
        walk.set(eb.slot, w);
        drawn.set(eb.slot, { x, y });
        if (scene) scene.player(x, y, sy, w, sp, rgb(hex));
        else flat.player(x, y, sy, hex, false);
        if (eb.flags & PB_FLAG.SHIELD) shields.push([x, y, hex]);
        if (me < 0 || !alive || lineOfSight(arena.obstacles, px, py, x, y)) labels.push([x, y, eb.slot, hex]);
      });
      if (scene) {
        scene.balls();
        for (const [x, y, hex] of shields) scene.shield(x, y, rgb(hex));
        scene.endWorld();
        if (alive) scene.viewGun(px, py, yaw, rgb(core.hex(me)), bob, reload > 0);
      }

      // --- HUD ---
      for (const [x, y, slot, hex] of labels) {
        const p = scene ? scene.project(x, y, 20, scratch) : null;
        if (p && p.depth < 320) hud.label(p.x, p.y, core.name(slot), hex);
      }
      if (alive) hud.splashes();
      const left = core.secondsLeft();
      if (L.phase === ARCADE_PHASE.PLAY) hud.timer(`${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`);
      hud.scoreboard([...L.ents].sort((a, b) => b.kills - a.kills).slice(0, 6)
        .map((e) => ({ name: core.name(e.slot), color: core.hex(e.slot), kills: e.kills, me: e.slot === me })));
      const t = nowS();
      hud.feed(feed.filter((f) => t - f.at < FEED_S));

      if (alive) {
        hud.crosshair(t - hitAt, core.hex(me));
        hud.health(mine.hp);
        hud.ammo(ammo, reload, core.hex(me));
      }
      if (L.phase === ARCADE_PHASE.COUNTDOWN) hud.center(String(Math.max(1, Math.ceil(left))), 'SPETTER ZE ONDER DE VERF!');
      else if (L.phase === ARCADE_PHASE.END) hud.center('EINDE!', '');
      else if (mine && !mine.alive) hud.center('GESPETTERD!', `${killer ? `door ${killer} · ` : ''}terug over ${Math.max(1, Math.ceil(mine.respawn))}`, '#ff5c7a');
      else if (banner && t < banner.until) hud.center(banner.text, banner.sub, banner.color);
      else if (me < 0) hud.center('', 'JE KIJKT MEE');
      if (alive && !touch && !locked && !lockFailed) hud.hint('Klik om te richten met de muis · Esc = muis los');
    },

    unmount() {
      for (const fn of cleanups) fn();
      scene?.destroy();
      core.reset();
    },
  };
}

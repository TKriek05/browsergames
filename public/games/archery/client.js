// Raak de Roos (client side): you look down your lane at your target. Point
// the sight pin where you want the arrow to go (the sight already allows for
// the drop at full draw, not for the wind), hold to draw the bow and let go
// to shoot. The longer you hold at full draw, the more the pin wobbles.
// Mouse, keys (arrows + space) and touch (hold, drag, let go).
import { PLAYER_COLORS } from '../../../shared/constants.js';
import { ARC, flyArrow, solveAim, targetOffset } from '../../../shared/games/archery.js';
import { drawText, roundRect } from '../../js/core/hudtext.js';
import { createArcheryScene, world, S, rgb } from './scene.js';
import { createArcheryHud } from './hud.js';

export const meta = { width: 480, height: 270, pixelated: false, gl: true, step: 1 / 60, input: false, touchControls: false };

const DRAW_S = 0.75; // to full draw
const TIRED_AFTER_S = 2.2;
const KEY_RATE = 0.05; // rad per second with the arrow keys
const AIM_FOV = (dist) => 2 * Math.atan((ARC.FACE_R * 3.4) / dist);
const WIDE_FOV = 0.95;
const TOUCH_LIFT = 34; // the pin sits this far above your finger

export function createGame() {
  let view, ctx, net, session, sfx, scene, hud, reduced;
  let snap = null;
  let recvAt = 0;
  let time = 0;
  let endShown = 0;
  let drawing = false;
  let drawT = 0; // seconds held
  let fullT = 0; // seconds at full draw
  let lastShot = -10;
  const aim = { x: 0, y: ARC.TARGET_H }; // where the pin points on the target plane (lane metres)
  const pointer = { x: 0, y: 0, has: false, touch: false };
  const keys = new Set();
  const anims = []; // arrows in flight: { lane, path, times, t0, dur, color, id, by, confirmed, score, x }
  const popups = []; // { text, color, t0 }
  const cam = { eye: [0, 0, 0], at: [0, 0, 0], fov: WIDE_FOV };
  const v3 = [0, 0, 0];
  const scratch = { x: 0, y: 0, depth: 0 };
  const cleanups = [];

  const me = () => session.me;
  const player = (id) => session.room?.players.find((p) => p.id === id) ?? null;
  const colorOf = (id) => PLAYER_COLORS[player(id)?.color ?? 0].hex;
  const nameOf = (id) => player(id)?.name ?? '?';
  const mine = () => snap?.archers.find((a) => a.id === me()) ?? null;
  const endTime = () => (snap ? snap.t + (performance.now() - recvAt) / 1000 : 0);
  const phaseLeft = () => (snap ? Math.max(0, snap.left - (performance.now() - recvAt) / 1000) : 0);
  const canShoot = () => snap?.phase === 'shoot' && (mine()?.left ?? 0) > 0 && time - lastShot >= ARC.ARROW_GAP_S;

  // Wobble of the pin (radians): a little always, more when you hold too long.
  function sway(out) {
    const tired = Math.min(1, Math.max(0, fullT - TIRED_AFTER_S) / 3);
    const amp = (drawing ? 0.0009 : 0.0005) + tired * 0.004;
    out.x = amp * (Math.sin(time * 1.3) + 0.6 * Math.sin(time * 3.1 + 1));
    out.y = amp * (Math.cos(time * 1.7) + 0.6 * Math.sin(time * 2.3 + 2));
    return out;
  }

  // Screen point → point on the target plane (lane metres) through the camera.
  function screenToAim(sx, sy) {
    const [ex, ey, ez] = cam.eye;
    let fx = cam.at[0] - ex;
    let fy = cam.at[1] - ey;
    let fz = cam.at[2] - ez;
    const fl = Math.hypot(fx, fy, fz);
    fx /= fl; fy /= fl; fz /= fl;
    // right = f × up, up' = right × f
    let rx = -fz;
    let rz = fx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    const ux = -rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy;
    const tan = Math.tan(cam.fov / 2);
    const nx = (sx / view.width) * 2 - 1;
    const ny = 1 - (sy / view.height) * 2;
    const aspect = view.width / view.height;
    const dx = fx + rx * nx * tan * aspect + ux * ny * tan;
    const dy = fy + ny * tan * uy;
    const dz = fz + rz * nx * tan * aspect + uz * ny * tan;
    const zPlane = -snap.distance * S;
    const t = (zPlane - ez) / dz;
    if (!(t > 0)) return;
    const a = mine();
    const lane = a?.lane ?? 0;
    aim.x = Math.max(-2, Math.min(2, (ex + dx * t) / S - (lane - (ARC.LANES - 1) / 2) * ARC.LANE_W));
    aim.y = Math.max(0, Math.min(3.5, (ey + dy * t) / S));
  }

  function startDraw() {
    if (!canShoot() || drawing) return;
    drawing = true;
    drawT = 0;
    fullT = 0;
    sfx.play('scrape');
  }

  function release() {
    if (!drawing) return;
    drawing = false;
    const draw = Math.min(1, drawT / DRAW_S);
    drawT = 0;
    fullT = 0;
    if (draw < ARC.MIN_DRAW || !canShoot()) return;
    const a = mine();
    const sw = sway({ x: 0, y: 0 });
    const tx = aim.x + sw.x * snap.distance;
    const ty = aim.y + sw.y * snap.distance;
    const sol = solveAim(snap.distance, tx, ty, 1, 0); // the sight is set for full draw, no wind
    const t = endTime();
    net.send('input', { data: { yaw: sol.yaw, pitch: sol.pitch, draw, t } });
    lastShot = time;
    launch(a.lane, sol.yaw, sol.pitch, draw, colorOf(me()), me(), false);
    sfx.play('throw');
  }

  // An arrow in flight along the same path the server flies.
  function launch(lane, yaw, pitch, draw, color, by, confirmed) {
    const path = [];
    const res = flyArrow(snap.distance, yaw, pitch, draw, snap.wind, path, 4);
    const times = path.map((_, i) => Math.min(res.t, i * 4 * ARC.DT));
    times[times.length - 1] = res.t;
    const anim = { lane, path, times, t0: time, dur: res.t, color, by, confirmed, score: null, x: false, hit: res.hit };
    anims.push(anim);
    return anim;
  }

  function onShot(msg) {
    if (msg.by === me()) {
      const anim = anims.find((a) => a.by === me() && !a.confirmed);
      if (anim) {
        anim.confirmed = true;
        anim.score = msg.s;
        anim.x = msg.x;
        return;
      }
    }
    const anim = launch(msg.lane, msg.yaw, msg.pitch, msg.draw, colorOf(msg.by), msg.by, true);
    anim.score = msg.s;
    anim.x = msg.x;
    sfx.play('throw');
  }

  function bindControls(canvas) {
    const logical = (e) => view.toLogical(e.clientX, e.clientY);
    const move = (e) => {
      const p = logical(e);
      pointer.x = p.x;
      pointer.y = p.y - (e.pointerType === 'touch' ? TOUCH_LIFT : 0);
      pointer.has = true;
      pointer.touch = e.pointerType === 'touch';
    };
    const down = (e) => {
      move(e);
      if (e.button === 0 || e.pointerType === 'touch') startDraw();
      canvas.setPointerCapture?.(e.pointerId);
    };
    const up = () => release();
    const keyDown = (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      keys.add(e.code);
      if (e.code === 'Space' || e.code === 'Enter') startDraw();
    };
    const keyUp = (e) => {
      keys.delete(e.code);
      if (e.code === 'Space' || e.code === 'Enter') release();
    };
    const blur = () => {
      keys.clear();
      release();
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', blur);
    cleanups.push(() => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', blur);
    });
  }

  // Position of an arrow in flight at `t` seconds (lane metres) + direction.
  function along(anim, t, out) {
    const { path, times } = anim;
    let i = 1;
    while (i < times.length - 1 && times[i] < t) i++;
    const a = path[i - 1];
    const b = path[i];
    const span = times[i] - times[i - 1] || 1;
    const k = Math.max(0, Math.min(1, (t - times[i - 1]) / span));
    out.x = a[0] + (b[0] - a[0]) * k;
    out.y = a[1] + (b[1] - a[1]) * k;
    out.z = a[2] + (b[2] - a[2]) * k;
    out.dx = b[0] - a[0];
    out.dy = b[1] - a[1];
    out.dz = b[2] - a[2] || 1e-6;
    return out;
  }
  const pos = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1 };

  return {
    mount(v, netRef, c) {
      view = v;
      ctx = v.ctx;
      net = netRef;
      session = c.session;
      sfx = c.sfx;
      reduced = c.reducedMotion;
      scene = view.glCanvas ? createArcheryScene(view.glCanvas, { reducedMotion: reduced }) : null;
      if (!scene) view.glCanvas?.remove();
      hud = createArcheryHud(view);
      view.canvas.style.touchAction = 'none';
      view.canvas.style.cursor = 'crosshair';
      bindControls(view.canvas);
    },

    onSnapshot(msg) {
      snap = msg.state;
      recvAt = performance.now();
      if (snap.end !== endShown) {
        endShown = snap.end;
        aim.x = 0;
        aim.y = ARC.TARGET_H;
        drawing = false;
        lastShot = -10;
      }
    },

    onEvent(msg) {
      switch (msg.e) {
        case 'go': sfx.play('go'); break;
        case 'round': sfx.play('countdown'); break;
        case 'shot': onShot(msg); break;
        case 'endScore': sfx.play('ready'); break;
        case 'end': sfx.play('win'); break;
        default: break;
      }
    },

    update(dt) {
      time += dt;
      scene?.update(dt);
      if (!snap) return;
      // Keys move the pin.
      const kx = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
      const ky = (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0) - (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0);
      if (kx || ky) {
        pointer.has = false;
        aim.x = Math.max(-2, Math.min(2, aim.x + kx * KEY_RATE * snap.distance * dt));
        aim.y = Math.max(0, Math.min(3.5, aim.y + ky * KEY_RATE * snap.distance * dt));
      }
      if (drawing) {
        drawT += dt;
        if (drawT >= DRAW_S) fullT += dt;
        if (!canShoot()) drawing = false;
      }
      // Arrows that arrived.
      for (let i = anims.length - 1; i >= 0; i--) {
        const a = anims[i];
        if (time - a.t0 < a.dur) continue;
        anims.splice(i, 1);
        const end = a.path[a.path.length - 1];
        scene?.thud(a.lane, end[0], end[1], end[2]);
        if (a.by === me()) {
          const s = a.score ?? 0;
          popups.push({ text: s === 0 ? 'MIS' : a.x ? 'X!' : String(s), color: s >= 9 ? '#ffd23e' : s >= 7 ? '#ff6b5a' : s > 0 ? '#ffffff' : '#9aa3ad', t0: time });
          sfx.play(s >= 9 ? 'coin' : s > 0 ? 'thud' : 'plop');
        } else if (a.hit) sfx.play('thud');
      }
    },

    render() {
      ctx.clearRect(0, 0, view.width, view.height);
      if (!snap) return;
      const a = mine();
      const lane = a?.lane ?? Math.floor(ARC.LANES / 2);
      const dist = snap.distance;
      // Camera: a wide shot during the intro, then the view down your lane.
      const intro = snap.phase === 'intro' ? Math.min(1, phaseLeft() / (ARC.INTRO_S * 0.8)) : 0;
      const spectator = !a;
      const k = spectator ? 1 : intro * intro;
      world(lane, 0.05, ARC.EYE + 0.1, -0.6, v3);
      const ex = v3[0];
      const ey = v3[1];
      const ez = v3[2];
      cam.eye[0] = ex * (1 - k) + 0 * k;
      cam.eye[1] = ey * (1 - k) + 60 * k;
      cam.eye[2] = ez * (1 - k) + 160 * k;
      world(lane, 0, ARC.TARGET_H, dist, v3);
      cam.at[0] = v3[0] * (1 - k) + 0 * k;
      cam.at[1] = v3[1];
      cam.at[2] = v3[2] * (1 - k) + -dist * S * 0.5 * k;
      cam.fov = AIM_FOV(dist) * (1 - k) + WIDE_FOV * k;
      if (pointer.has && !spectator && k === 0) screenToAim(pointer.x, pointer.y);
      const t = endTime();
      if (scene) {
        if (!scene.begin(cam.eye, cam.at, cam.fov)) return;
        scene.flags(snap.wind);
        for (const ar of snap.archers) {
          const off = targetOffset(ar.lane, t, snap.moving);
          scene.target(ar.lane, off, dist);
          if (ar.id !== me() || k > 0.8) scene.archer(ar.lane, rgb(colorOf(ar.id)), 0);
          // Stuck arrows (not the ones still flying).
          const flying = anims.filter((f) => f.by === ar.id && f.confirmed).length;
          const shown = ar.arrows.length - flying;
          for (let i = 0; i < shown; i++) {
            const s = ar.arrows[i];
            const color = rgb(colorOf(ar.id));
            if (s.gz !== undefined) scene.arrow(ar.lane, s.gx, 0.25, s.gz + 0.2, 0.02, -0.6, 1, color);
            else scene.arrow(ar.lane, off + s.ax, ARC.TARGET_H + s.ay, dist + 0.12, 0, -0.04, 1, color);
          }
        }
        for (const f of anims) {
          along(f, time - f.t0, pos);
          scene.arrow(f.lane, pos.x, pos.y, pos.z, pos.dx, pos.dy, pos.dz, rgb(f.color));
        }
        scene.endParticles();
      }

      // --- HUD ---
      const left = phaseLeft();
      hud.info(snap, left);
      hud.scores(snap.archers.map((ar) => ({ name: nameOf(ar.id), color: colorOf(ar.id), total: ar.total, arrows: ar.arrows, me: ar.id === me() })), snap.phase === 'score');
      if (a && snap.phase === 'shoot' && scene && k === 0) {
        const sw = sway({ x: 0, y: 0 });
        world(lane, aim.x + sw.x * dist, aim.y + sw.y * dist, dist, v3);
        const p = scene.project(v3[0], v3[1], v3[2], scratch);
        if (p) hud.pin(p.x, p.y, drawing ? Math.min(1, drawT / DRAW_S) : 0, colorOf(me()), canShoot());
        hud.bow(Math.min(1, drawT / DRAW_S), drawing, fullT > TIRED_AFTER_S);
        hud.quiver(a.left);
        if (snap.end === 1 && a.left === ARC.ARROWS && !drawing) {
          hud.hint(pointer.touch ? 'Houd je vinger op het scherm, richt en laat los' : 'Richt met de muis of pijltjes · houd ingedrukt (of spatie) · laat los = schieten');
        }
      }
      for (let i = popups.length - 1; i >= 0; i--) {
        const pp = popups[i];
        const age = time - pp.t0;
        if (age > 1.3) {
          popups.splice(i, 1);
          continue;
        }
        drawText(ctx, pp.text, view.width / 2, 58 - age * 12, { color: pp.color, scale: 3.2, align: 'center', shadow: '#1a1a24' });
      }
      if (snap.phase === 'intro') hud.center(`RONDE ${snap.end} · ${dist} METER`, windText(snap.wind) + (snap.moving ? ' · bewegend doel!' : ''));
      else if (snap.phase === 'end') {
        const best = [...snap.archers].sort((x, y) => y.total - x.total)[0];
        hud.center('EINDE!', best ? `${nameOf(best.id)} wint met ${best.total} punten` : '');
      } else if (!a) hud.center('', 'JE KIJKT MEE');
      else if (snap.phase === 'shoot' && a.left === 0) hud.center('', 'Wachten op de anderen …');
      if (!scene) {
        ctx.fillStyle = '#6aa94c';
        roundRect(ctx, 10, 60, 160, 40, 6);
        ctx.fill();
        drawText(ctx, 'Geen 3D beschikbaar', 18, 72, { color: '#ffffff' });
      }
    },

    unmount() {
      for (const fn of cleanups) fn();
      scene?.destroy();
    },
  };
}

export function windText(wind) {
  if (!wind) return 'Geen wind';
  return `Wind ${wind > 0 ? '→' : '←'} ${Math.abs(wind).toFixed(1).replace('.', ',')} m/s`;
}

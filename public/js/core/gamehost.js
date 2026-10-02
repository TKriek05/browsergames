// Mounts a client game module into the game view: canvas, input, touch
// controls, HUD (ping, mute, fullscreen, leave) and the render loop.
//
// ─── Game module interface (client) ────────────────────────────────────────
// public/games/<id>/client.js exports:
//   meta = { width, height, pixelated, step, touchButtons: [{ label, bit }], keys?,
//            layout?: 'board' (adds a side panel), input?: false, touchControls?: false,
//            gl?: true (3D: view.glCanvas for WebGL + view.canvas/ctx as a 2D HUD on top) }
//   createGame() → {
//     mount(view, net, ctx)   view = { canvas, ctx, width, height, toLogical }
//                             ctx  = { session, input, sfx, start, side, reducedMotion }
//     onSnapshot(snap)        binary: { tick, time, reader }  JSON: { tick, time, state }
//     onEvent?(msg)           { e: 'name', ...data }
//     onRoom?(room)           lobby/room state changed (names, colours)
//     onReconnect?()          socket came back: reset prediction
//     update?(dt)             fixed timestep logic (input sampling, prediction)
//     render(alpha)           draw; alpha = interpolation between fixed steps
//     unmount()
//   }
// ─────────────────────────────────────────────────────────────────────────────
import { S2C, BIN } from '../../../shared/messages.js';
import { getGame } from '../../../shared/catalog.js';
import { createGameCanvas } from './canvas.js';
import { createLoop } from './loop.js';
import { Input, isTouchDevice } from './input.js';
import { createTouchControls } from './touch.js';
import * as sfx from './audio.js';
import * as music from './music.js';
import { h, clear, prefersReducedMotion, confirmDialog } from './ui.js';

const modules = new Map();

export function loadGameModule(id) {
  if (!getGame(id)) return Promise.reject(new Error(`unknown game ${id}`));
  if (!modules.has(id)) {
    const p = import(`../../games/${id}/client.js`);
    p.catch(() => modules.delete(id));
    modules.set(id, p);
  }
  return modules.get(id);
}

export class GameHost {
  constructor(root, session, { onLeave }) {
    this.root = root;
    this.session = session;
    this.onLeave = onLeave;
    this.game = null;
    this.cleanups = [];
    this.pendingSnap = null;
    this.mounted = false;
    this.mountSeq = 0; // increases forever
    this.currentMount = 0; // 0 = nothing mounted
  }

  get active() {
    return this.currentMount > 0;
  }

  async mount(start) {
    this.unmount();
    const token = ++this.mountSeq;
    this.currentMount = token;
    const net = this.session.net;

    // Subscribe right away and buffer: the first snapshot can arrive while
    // the module is still loading.
    const deliver = (snap) => {
      if (this.game && this.mounted) this.game.onSnapshot(snap);
      else this.pendingSnap = snap;
    };
    this.cleanups.push(
      net.on('binary', (m) => m.type === BIN.SNAPSHOT && deliver(m)),
      net.on(S2C.SNAP, (m) => deliver(m)),
      net.on(S2C.EVENT, (m) => this.mounted && this.game?.onEvent?.(m)),
      net.on('status', ({ status, reconnected }) => {
        if (status === 'open' && reconnected) this.game?.onReconnect?.();
      }),
      this.session.on('room', ({ room }) => this.mounted && this.game?.onRoom?.(room)),
    );

    this._buildDom(start);
    let mod;
    try {
      mod = await loadGameModule(start.game);
    } catch (err) {
      console.warn('Game module failed to load', err);
      this.stage.append(h('p', { class: 'game__error' }, 'Dit spel kon niet geladen worden. Ververs de pagina.'));
      return;
    }
    if (token !== this.currentMount) return; // unmounted meanwhile

    const meta = mod.meta;
    // Board games: canvas + side panel (turns, buttons). Realtime games: canvas only.
    let side = null;
    let canvasArea = this.stage;
    if (meta.layout === 'board') {
      canvasArea = h('div', { class: 'board-layout__canvas' });
      side = h('aside', { class: 'board-layout__side', 'aria-label': 'Spelinformatie' });
      this.stage.append(h('div', { class: 'board-layout' }, canvasArea, side));
    }
    this.view = createGameCanvas(canvasArea, meta);
    // Clicking the field takes the focus off a HUD button (🔊, ⛶ …): otherwise
    // Space would press that button again instead of reaching the game.
    canvasArea.addEventListener('pointerdown', () => {
      const el = document.activeElement;
      if (el && el !== document.body && this.root.contains(el) && el.closest('button, a')) el.blur();
    });
    if (meta.input !== false) this.input = new Input(meta.keys); // meta.keys: game-specific key map (optional)
    if (this.input && meta.touchControls !== false && isTouchDevice()) {
      this.touch = createTouchControls(this.root, this.input, { buttons: meta.touchButtons ?? [] });
    }

    this.game = mod.createGame();
    this.game.mount(this.view, net, {
      session: this.session,
      input: this.input,
      sfx,
      start,
      side,
      reducedMotion: prefersReducedMotion(),
    });
    this.mounted = true;
    if (this.pendingSnap) {
      this.game.onSnapshot(this.pendingSnap);
      this.pendingSnap = null;
    }
    this.loop = createLoop({
      step: meta.step ?? 1 / 60,
      update: (dt) => this.game.update?.(dt),
      render: (alpha) => this.game.render(alpha),
    });
    this.loop.start();
    music.playMusic(start.game);
    this.view.canvas.focus?.();
  }

  _buildDom(start) {
    const game = getGame(start.game);
    clear(this.root);
    this.pingEl = h('span', { class: 'hud__ping', title: 'Vertraging naar de server' }, '… ms');
    const muteBtn = h('button', { class: 'hud__btn', type: 'button', 'aria-pressed': String(sfx.isMuted()), onclick: () => sfx.setMuted(!sfx.isMuted()) }, sfx.isMuted() ? '🔇' : '🔊');
    muteBtn.setAttribute('aria-label', 'Geluid aan/uit');
    this.cleanups.push(sfx.onMuteChange((m) => {
      muteBtn.textContent = m ? '🔇' : '🔊';
      muteBtn.setAttribute('aria-pressed', String(m));
    }));
    const musicBtn = h('button', {
      class: 'hud__btn hud__btn--music', type: 'button', 'aria-label': 'Muziek', title: 'Muziek aan/uit',
      'aria-pressed': String(music.isMusicOn()), onclick: () => music.setMusicOn(!music.isMusicOn()),
    }, '🎵');
    this.cleanups.push(music.onMusicChange((on) => musicBtn.setAttribute('aria-pressed', String(on))));

    const t = this.session.room?.party?.tournament;
    const hud = h('div', { class: 'hud' },
      h('span', { class: 'hud__title' }, game?.title ?? ''),
      t && !t.done ? h('span', { class: 'hud__code', title: 'Toernooi' }, `🏆 ${t.played + 1}/${t.length}`) : null,
      h('span', { class: 'hud__code', 'aria-label': `Kamercode ${this.session.room?.code ?? ''}` }, this.session.room?.code ?? ''),
      h('span', { class: 'hud__spacer' }),
      this.pingEl,
      musicBtn,
      muteBtn,
    );
    if (document.fullscreenEnabled) {
      hud.append(h('button', {
        class: 'hud__btn', type: 'button', 'aria-label': 'Volledig scherm',
        onclick: () => (document.fullscreenElement ? document.exitFullscreen() : this.root.requestFullscreen()).catch(() => {}),
      }, '⛶'));
    }
    if (this.session.isHost) {
      hud.append(h('button', {
        class: 'hud__btn hud__btn--text', type: 'button',
        onclick: async () => {
          if (await confirmDialog('Terug naar de lobby?', 'Het spel stopt voor iedereen.', 'Stop spel')) this.session.send('toLobby');
        },
      }, 'Stop'));
    }
    hud.append(h('button', {
      class: 'hud__btn hud__btn--text', type: 'button',
      onclick: async () => {
        if (await confirmDialog('Kamer verlaten?', 'Je plek wordt overgenomen door een bot of vrijgegeven.', 'Verlaat')) this.onLeave();
      },
    }, 'Verlaat'));

    this.stage = h('div', { class: 'game__stage' });
    this.root.append(hud, this.stage);
    if (game?.kind === 'realtime') {
      this.root.append(h('p', { class: 'game__rotate-hint', 'aria-hidden': 'true' }, 'Tip: draai je telefoon voor een groter beeld'));
    }

    const tickPing = () => {
      const rtt = this.session.net?.rtt ?? 0;
      this.pingEl.textContent = rtt ? `${Math.round(rtt)} ms` : '… ms';
      this.pingEl.dataset.quality = rtt < 80 ? 'good' : rtt < 180 ? 'ok' : 'bad';
    };
    const pingTimer = setInterval(tickPing, 1000);
    this.cleanups.push(() => clearInterval(pingTimer));
  }

  unmount() {
    this.currentMount = 0;
    this.mounted = false;
    this.loop?.stop();
    this.loop = null;
    music.stopMusic();
    try {
      this.game?.unmount();
    } catch (err) {
      console.warn('unmount failed', err);
    }
    this.game = null;
    this.touch?.destroy();
    this.touch = null;
    this.input?.destroy();
    this.input = null;
    this.view?.destroy();
    this.view = null;
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
    this.pendingSnap = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    clear(this.root);
  }
}

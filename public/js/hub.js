// App entry: the hub (game cards, nickname, join by code) and the switching
// between hub, lobby, game and message views. One page, one WebSocket.
import { ROOM_CODE_PATTERN, ROOM_CODE_ALPHABET, NAME_MAX_LENGTH } from '../../shared/constants.js';
import { ERR, ERROR_TEXT, CLOSE } from '../../shared/messages.js';
import { CATALOG, getGame } from '../../shared/catalog.js';
import { sanitizeName } from '../../shared/names.js';
import { Session } from './core/session.js';
import { GameHost, loadGameModule } from './core/gamehost.js';
import { h, $, clear, toast, dialog } from './core/ui.js';
import { local } from './core/storage.js';
import * as sfx from './core/audio.js';
import { drawText, measureText } from './core/pixelfont.js';
import { drawThumb } from './thumbs.js';
import { Lobby } from './lobby.js';

const session = new Session();
const views = {
  hub: $('#view-hub'),
  lobby: $('#view-lobby'),
  game: $('#view-game'),
  message: $('#view-message'),
};
const lobby = new Lobby(views.lobby, session, { onLeave: leaveRoom });
const gameHost = new GameHost(views.game, session, { onLeave: leaveRoom });
const overlay = $('#conn-overlay');
let current = 'hub';
let lastGameId = null;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
function show(name, { focus = true } = {}) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  current = name;
  document.body.dataset.view = name;
  if (name !== 'game') gameHost.unmount();
  if (focus) {
    const target = views[name].querySelector('h1, h2, [data-autofocus]');
    if (target) {
      if (!target.hasAttribute('tabindex') && !target.matches('input, button, select')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: false });
    }
  }
}

function setUrl(code) {
  const url = code ? `/?room=${code}` : '/';
  if (location.pathname + location.search !== url) history.replaceState(null, '', url);
}

function showMessage({ title, text, actions = [] }) {
  const box = views.message;
  clear(box);
  box.append(
    h('div', { class: 'message panel' },
      h('h2', { class: 'message__title' }, title),
      text ? h('p', { class: 'message__text' }, text) : null,
      h('div', { class: 'message__actions' },
        ...actions.map((a) => h('button', { class: `btn ${a.primary ? 'btn--primary' : ''}`, type: 'button', onclick: a.run }, a.label)),
      ),
    ),
  );
  show('message');
}

function errorMessage(code, { gameId = lastGameId } = {}) {
  const game = getGame(gameId);
  const actions = [];
  if (game?.available) actions.push({ label: 'Maak nieuwe kamer', primary: true, run: () => createRoom(game.id) });
  else actions.push({ label: 'Maak nieuwe kamer', primary: true, run: () => goHub('games') });
  actions.push({ label: 'Naar de arcade', run: () => goHub() });
  const titles = {
    [ERR.ROOM_NOT_FOUND]: 'Kamer niet gevonden',
    [ERR.ROOM_FULL]: 'Kamer zit vol',
    [ERR.ROOM_CLOSED]: 'Kamer gesloten',
    [ERR.KICKED]: 'Uit de kamer verwijderd',
    [ERR.BAD_CODE]: 'Ongeldige kamercode',
  };
  sfx.play('error');
  showMessage({ title: titles[code] ?? 'Dat ging mis', text: ERROR_TEXT[code] ?? 'Er ging iets mis. Probeer het opnieuw.', actions });
}

function goHub(focusSection) {
  setUrl(null);
  hideOverlay();
  show('hub');
  if (focusSection === 'games') $('#games-title')?.focus();
}

// ---------------------------------------------------------------------------
// Nickname
// ---------------------------------------------------------------------------
function savedName() {
  return sanitizeName(local.get('name', '') ?? '');
}

async function askName(title = 'Hoe heet je?') {
  const input = h('input', {
    class: 'input', value: savedName(), maxlength: String(NAME_MAX_LENGTH), autocomplete: 'nickname',
    'aria-label': 'Bijnaam', placeholder: 'Bijvoorbeeld Timon',
  });
  const ok = await dialog({
    title,
    body: h('div', {}, h('p', { class: 'muted' }, 'Kies een bijnaam. Die onthouden we op dit apparaat.'), input),
    actions: [{ label: 'Annuleer', value: false }, { label: 'Doe mee', value: true, primary: true }],
  });
  const name = sanitizeName(input.value);
  if (!ok || !name) return null;
  local.set('name', name);
  const field = $('#nickname');
  if (field) field.value = name;
  return name;
}

async function ensureName() {
  return savedName() || (await askName());
}

// ---------------------------------------------------------------------------
// Room flow
// ---------------------------------------------------------------------------
// gameId null = party lobby (the host picks games, or random / tournament).
async function createRoom(gameId, solo = false, mode = undefined) {
  const name = await ensureName();
  if (!name) return;
  lastGameId = gameId;
  sfx.play('click');
  try {
    await session.create(gameId, name, solo, mode);
  } catch (err) {
    handleRequestError(err, gameId);
  }
}

async function joinRoom(code) {
  code = code.toUpperCase();
  if (!ROOM_CODE_PATTERN.test(code)) return errorMessage(ERR.BAD_CODE);
  const name = await ensureName();
  if (!name) return goHub();
  try {
    await session.join(code, name);
  } catch (err) {
    handleRequestError(err);
  }
}

function handleRequestError(err, gameId) {
  if (err.code) {
    if ([ERR.ROOM_NOT_FOUND, ERR.ROOM_FULL, ERR.ROOM_CLOSED].includes(err.code)) return errorMessage(err.code, { gameId });
    sfx.play('error');
    return toast(ERROR_TEXT[err.code] ?? 'Er ging iets mis.', { type: 'error' });
  }
  showMessage({
    title: 'Geen verbinding',
    text: 'Kan de server niet bereiken. Controleer je internetverbinding en probeer het opnieuw.',
    actions: [{ label: 'Naar de arcade', primary: true, run: () => goHub() }],
  });
}

function leaveRoom() {
  session.leave();
  gameHost.unmount();
  goHub();
}

session.on('joined', (room) => {
  lastGameId = room.game;
  setUrl(room.code);
  loadGameModule(room.game).catch(() => {}); // prefetch while in the lobby
  if (current !== 'game') {
    show('lobby');
    lobby.render();
  }
});

session.on('start', (msg) => {
  if (gameHost.active && current === 'game') return; // already running (reconnect)
  show('game', { focus: false });
  gameHost.mount(msg);
});

session.on('room', ({ room }) => {
  if (room.state === 'lobby') loadGameModule(room.game).catch(() => {}); // the host may have picked another game
  if (room.state === 'lobby' && current === 'game') {
    show('lobby');
    lobby.render();
  }
});

session.on('end', (msg) => {
  const winner = msg.results?.rows?.[0];
  if (winner) sfx.play(winner.id === session.me ? 'win' : 'lose');
  if (msg.reason === 'aborted') toast('De host heeft het spel gestopt.');
  show('lobby');
  lobby.render();
});

session.on('error', (msg) => {
  if ([ERR.ROOM_CLOSED, ERR.KICKED, ERR.ROOM_NOT_FOUND].includes(msg.code) && current !== 'hub') {
    gameHost.unmount();
    hideOverlay();
    setUrl(null);
    return errorMessage(msg.code);
  }
  sfx.play('error');
  toast(msg.reason || ERROR_TEXT[msg.code] || 'Er ging iets mis.', { type: 'error' });
});

session.on('notice', (msg) => toast(msg.text));
session.on('outdated', () => {
  toast('Er is een nieuwe versie van de arcade.', { timeout: 0, action: { label: 'Ververs', run: () => location.reload() } });
});

// ---------------------------------------------------------------------------
// Connection overlay
// ---------------------------------------------------------------------------
function showOverlay(title, text, actions = []) {
  clear(overlay);
  overlay.append(h('div', { class: 'overlay__box', role: 'alertdialog', 'aria-live': 'assertive', 'aria-labelledby': 'ov-title' },
    h('div', { class: 'spinner', 'aria-hidden': 'true', hidden: actions.length > 0 }),
    h('h2', { id: 'ov-title' }, title),
    h('p', {}, text),
    actions.length ? h('div', { class: 'message__actions' },
      ...actions.map((a) => h('button', { class: `btn ${a.primary ? 'btn--primary' : ''}`, type: 'button', onclick: a.run }, a.label))) : null,
  ));
  overlay.hidden = false;
  overlay.querySelector('button')?.focus();
}

function hideOverlay() {
  overlay.hidden = true;
  clear(overlay);
}

session.on('status', ({ status, code, reconnected }) => {
  const inRoom = current === 'lobby' || current === 'game';
  if (status === 'reconnecting' && inRoom) {
    showOverlay('Verbinding verbroken', code === CLOSE.SERVER_RESTART ? 'De server wordt herstart. Even geduld…' : 'Opnieuw verbinden…');
  } else if (status === 'open') {
    if (!overlay.hidden) hideOverlay();
    if (reconnected && inRoom) toast('Weer verbonden!', { type: 'ok' });
  } else if (status === 'failed' && inRoom) {
    if (code === CLOSE.VERSION) {
      showOverlay('Nieuwe versie', ERROR_TEXT.VERSION_MISMATCH, [{ label: 'Ververs de pagina', primary: true, run: () => location.reload() }]);
    } else if (code === CLOSE.KICKED) {
      hideOverlay();
      setUrl(null);
      errorMessage(ERR.KICKED);
    } else if (code === CLOSE.REPLACED) {
      showOverlay('Geopend in een ander tabblad', 'Je speelt nu verder in een ander tabblad of venster.', [
        { label: 'Hier verder spelen', primary: true, run: () => location.reload() },
        { label: 'Naar de arcade', run: () => leaveRoom() },
      ]);
    } else {
      showOverlay('Geen verbinding', 'Het lukt niet om opnieuw te verbinden.', [
        { label: 'Opnieuw proberen', primary: true, run: () => session.net?.retry() },
        { label: 'Naar de arcade', run: () => leaveRoom() },
      ]);
    }
  }
});

// ---------------------------------------------------------------------------
// Hub rendering
// ---------------------------------------------------------------------------
function drawLogo() {
  const canvas = $('#logo');
  if (!canvas) return;
  const text = "TIMON'S ARCADE";
  canvas.width = measureText(text) + 4;
  canvas.height = 11;
  const ctx = canvas.getContext('2d');
  drawText(ctx, text, 2, 2, { color: '#3ef0ff', shadow: '#ff3ea5' });
}

function renderHub() {
  const nickname = $('#nickname');
  nickname.value = savedName();
  nickname.maxLength = NAME_MAX_LENGTH;
  nickname.addEventListener('change', () => {
    const name = sanitizeName(nickname.value);
    nickname.value = name;
    if (name) local.set('name', name);
  });

  const codeInput = $('#join-code');
  const allowed = new RegExp(`[^${ROOM_CODE_ALPHABET}]`, 'g');
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(allowed, '').slice(0, 4);
  });
  $('#join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = codeInput.value.trim().toUpperCase();
    if (!ROOM_CODE_PATTERN.test(code)) {
      sfx.play('error');
      toast(ERROR_TEXT.BAD_CODE, { type: 'error' });
      codeInput.focus();
      return;
    }
    const name = sanitizeName(nickname.value);
    if (name) local.set('name', name);
    joinRoom(code);
  });

  $('#party-free').addEventListener('click', () => {
    lobby.party.openOnJoin = 'pick'; // the host starts by choosing a game
    createRoom(null, false, 'free');
  });
  $('#party-vote').addEventListener('click', () => {
    lobby.party.openOnJoin = 'vote';
    createRoom(null, false, 'vote');
  });
  $('#party-random').addEventListener('click', () => createRoom(null, false, 'random'));
  $('#party-tournament').addEventListener('click', () => createRoom(null, false, 'tournament'));

  const games = Object.values(CATALOG).sort((a, b) => Number(b.available) - Number(a.available) || a.phase - b.phase);
  const playable = $('#games-playable');
  const soon = $('#games-soon');
  for (const game of games) (game.available ? playable : soon).append(gameCard(game));
  // Nothing left to announce: hide the empty "Binnenkort" section.
  const nothingSoon = !soon.children.length;
  soon.hidden = nothingSoon;
  $('#soon-title').hidden = nothingSoon;

  const mute = $('#mute');
  const syncMute = (m) => {
    mute.textContent = m ? '🔇' : '🔊';
    mute.setAttribute('aria-pressed', String(m));
  };
  syncMute(sfx.isMuted());
  mute.addEventListener('click', () => sfx.setMuted(!sfx.isMuted()));
  sfx.onMuteChange(syncMute);
}

function gameCard(game) {
  const thumb = h('canvas', { class: 'card__thumb', 'aria-hidden': 'true' });
  drawThumb(thumb, game.id);
  const players = game.min === game.max ? `${game.max} spelers` : `${Math.max(1, game.min)}–${game.max} spelers`;
  const meta = h('ul', { class: 'card__meta' },
    h('li', {}, players),
    game.bots ? h('li', {}, 'Bots') : null,
    !game.available ? h('li', { class: 'card__soon' }, game.phase <= 4 ? `Fase ${game.phase}` : 'Extra') : null);
  const actions = game.available
    ? h('div', { class: 'card__actions' },
      h('button', { class: 'btn btn--primary', type: 'button', onclick: () => createRoom(game.id) }, 'Maak kamer'),
      game.bots ? h('button', { class: 'btn', type: 'button', onclick: () => createRoom(game.id, true), 'aria-label': `${game.title} solo tegen bots` }, 'Solo') : null)
    : h('p', { class: 'card__coming muted small' }, 'Binnenkort speelbaar');
  return h('li', { class: `card ${game.available ? '' : 'card--soon'}` },
    thumb,
    h('div', { class: 'card__body' },
      h('h3', { class: 'card__title' }, game.title),
      h('p', { class: 'card__tagline' }, game.tagline),
      meta,
      actions));
}

// Opened an invite link without a saved nickname: ask for it inline.
function showInvite(code) {
  const input = h('input', {
    id: 'invite-name', class: 'input input--big', maxlength: String(NAME_MAX_LENGTH), autocomplete: 'nickname',
    placeholder: 'Jouw bijnaam', required: true, 'data-autofocus': true,
  });
  const form = h('form', {
    class: 'invite',
    onsubmit: (e) => {
      e.preventDefault();
      const name = sanitizeName(input.value);
      if (!name) return input.focus();
      local.set('name', name);
      $('#nickname').value = name;
      joinRoom(code);
    },
  },
  h('label', { for: 'invite-name' }, 'Bijnaam'),
  h('div', { class: 'invite__row' }, input, h('button', { class: 'btn btn--primary', type: 'submit' }, 'Doe mee')));
  clear(views.message);
  views.message.append(h('div', { class: 'message panel' },
    h('p', { class: 'eyebrow' }, 'Uitnodiging'),
    h('h2', { class: 'message__title' }, `Kamer ${code}`),
    h('p', { class: 'message__text' }, 'Vul een bijnaam in en je zit meteen in de lobby.'),
    form,
    h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => goHub() }, 'Naar de arcade')));
  show('message', { focus: false });
  input.focus();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
drawLogo();
renderHub();

const params = new URLSearchParams(location.search);
const roomParam = params.get('room');
if (roomParam) {
  const code = roomParam.trim().toUpperCase();
  if (!ROOM_CODE_PATTERN.test(code)) {
    errorMessage(ERR.BAD_CODE);
  } else if (savedName()) {
    showMessage({ title: `Kamer ${code}`, text: 'Verbinden…' });
    joinRoom(code);
  } else {
    showInvite(code);
  }
} else {
  show('hub', { focus: false });
}

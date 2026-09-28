// Integration tests against a real server: static files, handshake checks,
// rooms, reconnect, host migration, full rooms, hostile clients.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startTestServer, TestClient, createRoom, joinRoom, sleep } from './helpers.js';
import { PROTOCOL_VERSION, MAX_PAYLOAD_BYTES } from '../shared/constants.js';
import { CLOSE, ERR } from '../shared/messages.js';

let server;
before(async () => {
  server = await startTestServer({
    buildId: 'testbuild',
    timing: { reconnectGraceMs: 300, hostMigrateDelayMs: 150, emptyRoomTtlMs: 300, idleRoomTtlMs: 60_000 },
  });
});
after(() => server.close());

// --- HTTP ---------------------------------------------------------------------
test('serves the hub with build id, CSP and correct MIME types', async () => {
  const res = await fetch(`${server.base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const html = await res.text();
  assert.ok(html.includes('?v=testbuild') && !html.includes('__BUILD__'));

  const js = await fetch(`${server.base}/js/hub.js`);
  assert.match(js.headers.get('content-type'), /text\/javascript/);
  assert.equal(js.headers.get('cache-control'), 'no-cache');
  const versioned = await fetch(`${server.base}/css/base.css?v=testbuild`);
  assert.match(versioned.headers.get('cache-control'), /immutable/);
  const shared = await fetch(`${server.base}/shared/constants.js`);
  assert.equal(shared.status, 200);

  const etag = js.headers.get('etag');
  const again = await fetch(`${server.base}/js/hub.js`, { headers: { 'if-none-match': etag } });
  assert.equal(again.status, 304);
});

test('blocks path traversal, dotfiles and unknown extensions', async () => {
  for (const path of ['/../server/config.js', '/%2e%2e/server/config.js', '/shared/../server/app.js', '/.env', '/%2e%2e%2fpackage.json', '/js/core', '/nope.exe']) {
    const res = await fetch(`${server.base}${path}`);
    assert.equal(res.status, 404, path);
  }
  const post = await fetch(`${server.base}/`, { method: 'POST' });
  assert.equal(post.status, 405);
});

test('/healthz reports status', async () => {
  const res = await fetch(`${server.base}/healthz`);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.protocol, PROTOCOL_VERSION);
  assert.equal(typeof body.rooms, 'number');
});

// --- Handshake ----------------------------------------------------------------
test('rejects WebSocket connections from a foreign origin', async () => {
  const err = await new TestClient(server, { origin: 'https://evil.example' }).open().catch((e) => e);
  assert.equal(err.status, 403);
  const noOrigin = await new Promise((resolve) => {
    const ws = new WebSocket(server.wsUrl);
    ws.on('unexpected-response', (req, res) => resolve(res.statusCode));
    ws.on('open', () => resolve('open'));
  });
  assert.equal(noOrigin, 403);
});

test('an old client version gets VERSION_MISMATCH and close code 4000', async () => {
  const c = await new TestClient(server).open({ hello: false });
  c.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION + 1 }));
  const err = await c.waitType('error');
  assert.equal(err.code, ERR.VERSION_MISMATCH);
  const closed = await c.waitClose();
  assert.equal(closed.code, CLOSE.VERSION);
});

test('oversized payloads close the connection (1009)', async () => {
  const c = await new TestClient(server).open();
  c.ws.send('x'.repeat(MAX_PAYLOAD_BYTES + 10));
  const closed = await c.waitClose();
  assert.equal(closed.code, 1009);
});

test('a flood of invalid messages gets the client disconnected (4003)', async () => {
  const c = await new TestClient(server).open();
  for (let i = 0; i < 60; i++) c.ws.send('{garbage');
  const closed = await c.waitClose();
  assert.equal(closed.code, CLOSE.POLICY);
});

test('lobby actions are rate limited', async () => {
  const host = await createRoom(server, 'Spammer');
  for (let i = 0; i < 30; i++) host.send('color');
  const err = await host.waitFor((m) => m.t === 'error' && m.code === ERR.RATE_LIMITED);
  assert.ok(err);
  host.close();
});

test('per-IP limits: rooms and concurrent connections', async () => {
  const strict = await startTestServer({ maxRoomsPerIp: 1, maxConnPerIp: 3 });
  try {
    const first = await createRoom(strict, 'Een');
    const c = await new TestClient(strict).open();
    c.send('create', { game: 'tag', name: 'Twee' });
    assert.equal((await c.waitType('error')).code, ERR.TOO_MANY_ROOMS);
    await new TestClient(strict).open();
    const refused = await new TestClient(strict).open().catch((e) => e);
    assert.equal(refused.status, 429);
    first.close();
  } finally {
    await strict.close();
  }
});

// --- Rooms ---------------------------------------------------------------------
test('create and join a room; duplicate names get a suffix', async () => {
  const host = await createRoom(server, 'Timon');
  assert.match(host.code, /^[A-HJKMNP-Z]{4}$/);
  const guest = await joinRoom(server, host.code, 'Timon');
  assert.equal(guest.joinResult.t, 'joined');
  const room = await host.latestRoom();
  assert.deepEqual(room.players.map((p) => p.name), ['Timon', 'Timon 2']);
  assert.equal(room.hostId, host.id);
  assert.ok(!JSON.stringify(room).includes(host.token), 'tokens are never broadcast');
  host.close();
  guest.close();
});

test('unknown room gives ROOM_NOT_FOUND', async () => {
  const c = await joinRoom(server, 'ZZZZ', 'Gast');
  assert.equal(c.joinResult.t, 'error');
  assert.equal(c.joinResult.code, ERR.ROOM_NOT_FOUND);
  c.close();
});

test('a room holds at most 6 people', async () => {
  const host = await createRoom(server, 'Host');
  const guests = [];
  for (let i = 0; i < 5; i++) guests.push(await joinRoom(server, host.code, `G${i}`));
  const extra = await joinRoom(server, host.code, 'Te laat');
  assert.equal(extra.joinResult.code, ERR.ROOM_FULL);
  for (const c of [host, extra, ...guests]) c.close();
});

test('in the lobby a human takes the place of a bot', async () => {
  const host = await createRoom(server, 'Host');
  host.send('fillBots', { level: 'hard' });
  let room = await host.latestRoom(60);
  assert.equal(room.players.filter((p) => p.bot).length, 5);
  const guest = await joinRoom(server, host.code, 'Mens');
  assert.equal(guest.joinResult.t, 'joined');
  room = await host.latestRoom(60);
  assert.equal(room.players.length, 6);
  assert.equal(room.players.filter((p) => p.bot).length, 4);
  assert.equal(room.players.find((p) => p.id === guest.id).role, 'player');
  host.close();
  guest.close();
});

test('reconnect with the session token keeps the seat', async () => {
  const host = await createRoom(server, 'Host');
  const guest = await joinRoom(server, host.code, 'Wifi-hapering');
  guest.close(); // abrupt drop
  let room = await host.latestRoom(80);
  assert.equal(room.players.find((p) => p.id === guest.id).connected, false);
  const back = await joinRoom(server, host.code, 'Wifi-hapering', guest.token);
  assert.equal(back.id, guest.id, 'same player id');
  room = await host.latestRoom(50);
  assert.equal(room.players.find((p) => p.id === guest.id).connected, true);
  assert.equal(room.players.length, 2);
  host.close();
  back.close();
});

test('a second tab with the same token takes over the seat (old one gets 4002)', async () => {
  const host = await createRoom(server, 'Host');
  const tab2 = await joinRoom(server, host.code, 'Host', host.token);
  assert.equal(tab2.id, host.id);
  const closed = await host.waitClose();
  assert.equal(closed.code, CLOSE.REPLACED);
  tab2.close();
});

test('the seat is released after the grace period', async () => {
  const host = await createRoom(server, 'Host');
  const guest = await joinRoom(server, host.code, 'Weg');
  guest.close();
  await sleep(500);
  const room = await host.latestRoom();
  assert.equal(room.players.length, 1);
  const late = await joinRoom(server, host.code, 'Weg', guest.token);
  assert.notEqual(late.id, guest.id, 'expired token = new player');
  host.close();
  late.close();
});

test('host migration when the host leaves', async () => {
  const host = await createRoom(server, 'Host');
  const guest = await joinRoom(server, host.code, 'Volgende');
  host.send('leave');
  await sleep(60);
  const room = await guest.latestRoom();
  assert.equal(room.hostId, guest.id);
  const notice = await guest.waitType('notice');
  assert.match(notice.text, /host/);
  host.close();
  guest.close();
});

test('host migration when the host stays disconnected', async () => {
  const host = await createRoom(server, 'Host');
  const guest = await joinRoom(server, host.code, 'Volgende');
  host.close();
  await sleep(350);
  const room = await guest.latestRoom();
  assert.equal(room.hostId, guest.id);
  guest.close();
});

test('only the host can start, kick or change settings', async () => {
  const host = await createRoom(server, 'Host');
  const guest = await joinRoom(server, host.code, 'Gast');
  guest.send('start');
  const err = await guest.waitType('error');
  assert.equal(err.code, ERR.NOT_HOST);
  guest.send('kick', { id: host.id });
  assert.equal((await guest.waitType('error')).code, ERR.NOT_HOST);
  host.send('settings', { settings: { duration: 60, arena: 'nope' } });
  const room = await host.latestRoom(60);
  assert.deepEqual(room.settings, { duration: 60, arena: 'pillars' });
  host.close();
  guest.close();
});

test('the host can kick a player (close 4001)', async () => {
  const host = await createRoom(server, 'Host');
  const guest = await joinRoom(server, host.code, 'Lastpak');
  host.send('kick', { id: guest.id });
  const err = await guest.waitType('error');
  assert.equal(err.code, ERR.KICKED);
  const closed = await guest.waitClose();
  assert.equal(closed.code, CLOSE.KICKED);
  host.close();
});

test('empty rooms are cleaned up', async () => {
  const host = await createRoom(server, 'Host');
  const code = host.code;
  host.send('leave');
  await sleep(500);
  const c = await joinRoom(server, code, 'Laat');
  assert.equal(c.joinResult.code, ERR.ROOM_NOT_FOUND);
  host.close();
  c.close();
});

// --- Games -----------------------------------------------------------------------
test('start a game: START, binary snapshots, reconnect, spectator, abort to lobby', async () => {
  const host = await createRoom(server, 'Host');
  const guest = await joinRoom(server, host.code, 'Gast');
  guest.send('start');
  await guest.waitType('error'); // not the host
  host.send('start');
  const notReady = await host.waitType('error');
  assert.equal(notReady.code, ERR.CANNOT_START);
  guest.send('ready', { ready: true });
  await sleep(30);
  host.send('start');
  const start = await host.waitType('start');
  assert.equal(start.game, 'tag');
  await guest.waitType('start');
  await sleep(250);
  assert.ok(host.binary.length >= 3, `snapshots received: ${host.binary.length}`);
  assert.equal(host.binary[0][0], 2, 'binary type SNAPSHOT');

  // Reconnect mid-game: JOINED first, then START again.
  guest.close();
  const back = await joinRoom(server, host.code, 'Gast', guest.token);
  assert.equal(back.id, guest.id);
  await back.waitType('start');

  // Someone joining mid-game becomes a spectator.
  const spec = await joinRoom(server, host.code, 'Kijker');
  assert.equal(spec.joinResult.room.players.find((p) => p.id === spec.id).role, 'spectator');
  await spec.waitType('start');

  host.send('toLobby');
  const end = await back.waitType('end');
  assert.equal(end.reason, 'aborted');
  const room = await host.latestRoom(60);
  assert.equal(room.state, 'lobby');
  assert.equal(room.players.find((p) => p.id === spec.id).role, 'player', 'spectator gets a free seat next round');
  for (const c of [host, back, spec]) c.close();
});

test('a player that stays away during a game is replaced by a bot', async () => {
  const host = await createRoom(server, 'Host');
  const guest = await joinRoom(server, host.code, 'Afwezig');
  guest.send('ready', { ready: true });
  await sleep(30);
  host.send('start');
  await host.waitType('start');
  guest.close();
  await sleep(500);
  const room = await host.latestRoom();
  const p = room.players.find((x) => x.id === guest.id);
  assert.equal(p.bot, 'normal');
  assert.equal(room.state, 'playing');
  host.close();
});

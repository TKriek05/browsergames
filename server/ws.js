// WebSocket side: handshake checks (path, origin, IP limits), the hello
// handshake, message routing, heartbeat and per-connection rate limits.
import { WebSocketServer } from 'ws';
import {
  WS_PATH, MAX_PAYLOAD_BYTES, HEARTBEAT_INTERVAL_MS, HELLO_TIMEOUT_MS, APP_VERSION, PROTOCOL_VERSION,
} from '../shared/constants.js';
import { C2S, S2C, ERR, CLOSE } from '../shared/messages.js';
import { parseJson, parseBinary, LOBBY_TYPES } from './protocol.js';
import { Connection } from './connection.js';
import { serverNow } from './clock.js';

const IP_PATTERN = /^[0-9a-fA-F:.]{2,45}$/;

// Client IP, taking Cloudflare / nginx headers into account only when the
// request comes from a trusted proxy (by default: nginx on this machine).
export function clientIp(req, trustProxy) {
  const remote = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  const fromLoopback = remote === '127.0.0.1' || remote === '::1';
  if (trustProxy === 'always' || (trustProxy === 'loopback' && fromLoopback)) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && IP_PATTERN.test(cf.trim())) return cf.trim();
    const real = req.headers['x-real-ip'];
    if (typeof real === 'string' && IP_PATTERN.test(real.trim()) && real.trim() !== remote) return real.trim();
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string') {
      const last = xff.split(',').pop().trim();
      if (IP_PATTERN.test(last)) return last;
    }
  }
  return remote || 'unknown';
}

export function originAllowed(req, allowedOrigins) {
  const origin = req.headers.origin;
  if (typeof origin !== 'string') return false;
  if (allowedOrigins.length) return allowedOrigins.includes(origin);
  // Default: the page must come from this same host.
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function reject(socket, status, text) {
  if (socket.writable) socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function attachWebSocket(httpServer, { config, log, rooms, ipLimiter }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES, perMessageDeflate: false });
  const connections = new Set();

  httpServer.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      return reject(socket, 400, 'Bad Request');
    }
    if (pathname !== WS_PATH) return reject(socket, 404, 'Not Found');
    if (!originAllowed(req, config.allowedOrigins)) {
      log.info('ws origin rejected', { origin: req.headers.origin ?? null });
      return reject(socket, 403, 'Forbidden');
    }
    const ip = clientIp(req, config.trustProxy);
    if (connections.size >= config.maxConnections) return reject(socket, 503, 'Service Unavailable');
    const limited = ipLimiter.checkConnect(ip);
    if (limited) {
      log.info('ws connect refused', { ip, reason: limited });
      return reject(socket, 429, 'Too Many Requests');
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, ip));
  });

  function onConnection(ws, ip) {
    const conn = new Connection(ws, ip, log);
    connections.add(conn);
    ipLimiter.addConnection(ip);
    log.debug('ws open', { conn: conn.id, ip });

    const helloTimer = setTimeout(() => {
      if (!conn.helloed) conn.close(CLOSE.HELLO_TIMEOUT, 'hello timeout');
    }, HELLO_TIMEOUT_MS);

    ws.on('pong', () => {
      conn.alive = true;
    });

    ws.on('message', (data, isBinary) => {
      conn.alive = true;
      if (conn.closed) return;
      if (!conn.limiter.messages.take()) return conn.strike('rate');

      if (isBinary) {
        if (!conn.helloed) return conn.strike('binary before hello');
        const r = parseBinary(data);
        if (!r.ok) return r.reason === 'version' ? versionMismatch(conn) : conn.strike(r.reason);
        if (!rooms.handleBinary(conn, r.reader)) conn.strike('bad input');
        return;
      }

      const r = parseJson(data);
      if (!r.ok) return r.reason === 'version' ? versionMismatch(conn) : conn.strike(r.reason);
      const msg = r.msg;

      if (msg.t === C2S.HELLO) {
        if (conn.helloed) return;
        conn.helloed = true;
        clearTimeout(helloTimer);
        return conn.send(S2C.WELCOME, {
          version: APP_VERSION,
          protocol: PROTOCOL_VERSION,
          build: config.buildId,
          time: serverNow(),
        });
      }
      if (!conn.helloed) return conn.strike('message before hello');
      if (msg.t === C2S.PING) return conn.send(S2C.PONG, { c: msg.c, s: serverNow() });
      if (LOBBY_TYPES.has(msg.t) && !conn.limiter.lobby.take()) {
        conn.strike('lobby rate');
        return conn.error(ERR.RATE_LIMITED);
      }
      if (msg.t === C2S.REACT && !conn.limiter.react.take()) return;
      try {
        rooms.handle(conn, msg);
      } catch (err) {
        log.error('message handler failed', { type: msg.t, err: err.stack });
      }
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      conn.closed = true;
      connections.delete(conn);
      ipLimiter.removeConnection(ip);
      rooms.onDisconnect(conn);
      log.debug('ws close', { conn: conn.id });
    });

    ws.on('error', (err) => log.debug('ws error', { conn: conn.id, err: err.message }));
  }

  function versionMismatch(conn) {
    conn.error(ERR.VERSION_MISMATCH, { protocol: PROTOCOL_VERSION });
    conn.close(CLOSE.VERSION, 'version mismatch');
  }

  // Heartbeat: WS ping frames keep proxies (Cloudflare ~100 s idle limit)
  // happy and let us detect dead sockets (phone in a pocket, wifi gone).
  const heartbeat = setInterval(() => {
    for (const conn of connections) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      try {
        conn.ws.ping();
      } catch {
        conn.ws.terminate();
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  return {
    connections,
    close(code = CLOSE.SERVER_RESTART, reason = 'server restart') {
      clearInterval(heartbeat);
      for (const conn of connections) conn.close(code, reason);
      wss.close();
    },
  };
}

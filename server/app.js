// Wires everything together. Kept separate from index.js so tests can start
// a server on a random port with custom options.
import { createServer } from 'node:http';
import { createLogger } from './log.js';
import { createHttpHandler } from './http.js';
import { attachWebSocket } from './ws.js';
import { RoomManager } from './rooms.js';
import { IpLimiter } from './ratelimit.js';
import { registry } from './games/index.js';
import { S2C } from '../shared/messages.js';

export async function startServer(config) {
  const log = config.log ?? createLogger(config.logLevel);
  const ipLimiter = new IpLimiter({
    maxConnPerIp: config.maxConnPerIp,
    maxRoomsPerIp: config.maxRoomsPerIp,
    connectPerMinute: config.connectsPerMinute,
    roomsPerMinute: config.roomsPerMinute,
  });
  const rooms = new RoomManager({ config, log, ipLimiter, registry });

  let ws = null;
  const handler = createHttpHandler({
    config,
    log,
    getStats: () => ({ connections: ws ? ws.connections.size : 0, ...rooms.stats() }),
  });
  const server = createServer(handler);
  server.keepAliveTimeout = 65_000; // longer than nginx' default upstream keepalive
  ws = attachWebSocket(server, { config, log, rooms, ipLimiter });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  const port = server.address().port;
  log.info(`Timon's Arcade luistert op http://${config.host}:${port}`, { build: config.buildId });

  let closing = null;
  function close() {
    if (closing) return closing;
    closing = new Promise((resolve) => {
      // Tell everyone, then hang up with 1012 so clients show "server restart".
      for (const conn of ws.connections) conn.send(S2C.NOTICE, { text: 'De server wordt herstart…', restart: true });
      ws.close();
      rooms.shutdown('server restart');
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
    return closing;
  }

  return { server, port, rooms, close, log };
}

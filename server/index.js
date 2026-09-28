// Entry point: `node server/index.js` (pm2 / systemd / npm start).
import { loadConfig } from './config.js';
import { startServer } from './app.js';

const config = loadConfig();
const app = await startServer(config);

// Graceful shutdown for pm2 reload/restart and systemd stop.
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  app.log.info(`${signal} ontvangen, netjes afsluiten…`);
  const force = setTimeout(() => process.exit(0), 5000);
  force.unref();
  await app.close();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  app.log.error('uncaught exception', { err: err.stack });
  // State may be corrupt: exit and let pm2/systemd restart us.
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  app.log.error('unhandled rejection', { err: err?.stack ?? String(err) });
});

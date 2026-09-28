// Minimal leveled logger: one line per event, easy to grep in pm2 logs.
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3, silent: -1 };

export function createLogger(level = 'info') {
  const max = LEVELS[level] ?? LEVELS.info;
  const write = (lvl, msg, data) => {
    if (LEVELS[lvl] > max || max < 0) return;
    const line = `${new Date().toISOString()} ${lvl.toUpperCase().padEnd(5)} ${msg}${data ? ' ' + JSON.stringify(data) : ''}`;
    if (lvl === 'error' || lvl === 'warn') console.error(line);
    else console.log(line);
  };
  return {
    error: (msg, data) => write('error', msg, data),
    warn: (msg, data) => write('warn', msg, data),
    info: (msg, data) => write('info', msg, data),
    debug: (msg, data) => write('debug', msg, data),
    isDebug: max >= LEVELS.debug,
  };
}

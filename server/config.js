// Runtime configuration from environment variables (optionally a .env file).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { APP_VERSION } from '../shared/constants.js';

export const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

// Node >= 20.12 can read .env files itself; no dotenv dependency needed.
const envFile = join(ROOT_DIR, '.env');
if (existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

const env = process.env;

function int(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function list(value) {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

// A hash of every file the browser can load (public/ and shared/): it
// changes exactly when the site changes, also after a plain `git pull`.
function contentHash() {
  const hash = createHash('sha1');
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, `${rel}/${entry.name}`);
      else if (entry.isFile()) hash.update(`${rel}/${entry.name}\0`).update(readFileSync(path));
    }
  };
  walk(join(ROOT_DIR, 'public'), 'public');
  walk(join(ROOT_DIR, 'shared'), 'shared');
  return hash.digest('hex').slice(0, 10);
}

// Build id for cache busting: every asset is served under /v/<build>/.
// The deploy script's .build-id (if any) is kept in front, so /healthz
// still shows which deploy is live.
function buildId() {
  if (env.BUILD_ID) return env.BUILD_ID;
  const file = join(ROOT_DIR, '.build-id');
  let prefix = APP_VERSION;
  if (existsSync(file)) {
    const id = readFileSync(file, 'utf8').trim();
    if (/^[\w.-]{1,40}$/.test(id)) prefix = id;
  }
  return `${prefix}-${contentHash()}`;
}

export function loadConfig(overrides = {}) {
  return {
    port: int(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    // Exact origins, e.g. "https://games.tkriek.dev". Empty = same host only.
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    maxRooms: int(env.MAX_ROOMS, 500),
    maxConnections: int(env.MAX_CONNECTIONS, 3000),
    maxConnPerIp: int(env.MAX_CONN_PER_IP, 24),
    maxRoomsPerIp: int(env.MAX_ROOMS_PER_IP, 8),
    connectsPerMinute: int(env.CONNECTS_PER_MINUTE, 60),
    roomsPerMinute: int(env.ROOMS_PER_MINUTE, 12),
    // 'loopback' = trust CF-Connecting-IP / X-Forwarded-For only when the
    // request comes from 127.0.0.1 (nginx on the same machine).
    trustProxy: ['always', 'never', 'loopback'].includes(env.TRUST_PROXY) ? env.TRUST_PROXY : 'loopback',
    logLevel: env.LOG_LEVEL || 'info',
    buildId: buildId(),
    // Long-lived caching of /v/<build>/ assets. Off in development: there the
    // build id is computed once at start, while public/ files keep changing.
    immutableAssets: env.NODE_ENV === 'production',
    // Timing overrides are only used by tests.
    timing: {},
    ...overrides,
  };
}

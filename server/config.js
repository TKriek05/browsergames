// Runtime configuration from environment variables (optionally a .env file).
import { readFileSync, existsSync } from 'node:fs';
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

// The deploy script writes .build-id; it is used for ?v= cache busting.
function buildId() {
  if (env.BUILD_ID) return env.BUILD_ID;
  const file = join(ROOT_DIR, '.build-id');
  if (existsSync(file)) {
    const id = readFileSync(file, 'utf8').trim();
    if (/^[\w.-]{1,64}$/.test(id)) return id;
  }
  return `${APP_VERSION}-${Date.now().toString(36)}`;
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
    // Timing overrides are only used by tests.
    timing: {},
    ...overrides,
  };
}

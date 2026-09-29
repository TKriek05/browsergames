// HTTP handler: static files from public/ (and shared/ under /shared/),
// /healthz, correct MIME types, ETags, cache headers and gzip. No framework.
import { stat, readFile } from 'node:fs/promises';
import { join, normalize, sep, extname } from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { ROOT_DIR } from './config.js';
import { APP_VERSION, PROTOCOL_VERSION, WS_PATH } from '../shared/constants.js';

const PUBLIC_DIR = join(ROOT_DIR, 'public');
const SHARED_DIR = join(ROOT_DIR, 'shared');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const MAX_CACHED_FILE = 512 * 1024;
const GZIP_MIN = 1024; // smaller text files are not worth compressing
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt']);
const gzipAsync = promisify(gzip);
// Keep the whole site out of search engines. Sent on every response (pages,
// assets, errors), so crawlers must be allowed to fetch: no robots.txt block.
const ROBOTS_TAG = 'noindex, nofollow, noarchive';
const cache = new Map(); // path -> { mtimeMs, size, body, etag, gz? }

// Every asset lives under /v/<build>/public/… or /v/<build>/shared/… (the
// layout on disk): relative ES module imports inherit that prefix, so each
// file of a new build has a new URL (no stale modules mixed with fresh ones,
// whatever a browser or proxy cached), and every import that is right on
// disk is right as a URL too.
const VERSIONED = /^\/v\/([\w.-]{1,64})\/(public|shared)(\/.*)$/;

// Map a URL path to a file on disk, or null when it is not allowed.
function resolvePath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const v = VERSIONED.exec(decoded);
  if (v) decoded = v[2] === 'shared' ? `/shared${v[3]}` : v[3];
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  if (decoded.split('/').some((seg) => seg.startsWith('.'))) return null; // no dotfiles, no ..

  let base = PUBLIC_DIR;
  let rel = decoded;
  if (decoded.startsWith('/shared/')) {
    base = SHARED_DIR;
    rel = decoded.slice('/shared'.length);
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const full = normalize(join(base, rel));
  if (!full.startsWith(base + sep)) return null;
  if (!Object.hasOwn(MIME, extname(full).toLowerCase())) return null;
  return full;
}

export function securityHeaders(req, config) {
  const host = req.headers.host ?? '';
  const wsSources = config.allowedOrigins.length
    ? config.allowedOrigins.map((o) => o.replace(/^http/, 'ws')).join(' ')
    : `ws://${host} wss://${host}`;
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data: blob:",
      `connect-src 'self' ${wsSources}`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

export function createHttpHandler({ config, log, getStats }) {
  const startedAt = Date.now();

  async function serveFile(req, res, url) {
    const full = resolvePath(url.pathname);
    if (!full) return notFound(res);

    let info;
    try {
      info = await stat(full);
    } catch {
      return notFound(res);
    }
    if (!info.isFile()) return notFound(res);

    const ext = extname(full).toLowerCase();
    const isHtml = ext === '.html';
    let entry = cache.get(full);
    if (!entry || entry.mtimeMs !== info.mtimeMs || entry.size !== info.size) {
      let body = await readFile(full);
      // Inject the build id so the page links its assets under /v/<build>/.
      if (isHtml) body = Buffer.from(body.toString('utf8').replaceAll('__BUILD__', config.buildId));
      entry = { mtimeMs: info.mtimeMs, size: info.size, body, etag: `W/"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}-${config.buildId}"` };
      if (info.size <= MAX_CACHED_FILE) cache.set(full, entry);
    }

    // HTML and anything outside the current build: always revalidate (cheap
    // 304s). Files under /v/<current build>/ never change: cache for a year.
    const v = VERSIONED.exec(url.pathname);
    const current = config.immutableAssets && ((v && v[1] === config.buildId) || url.searchParams.get('v') === config.buildId);
    res.setHeader('Content-Type', MIME[ext]);
    res.setHeader('Cache-Control', !isHtml && current ? 'public, max-age=31536000, immutable' : 'no-cache');
    res.setHeader('ETag', entry.etag);
    if (isHtml) for (const [k, v] of Object.entries(securityHeaders(req, config))) res.setHeader(k, v);
    else res.setHeader('X-Content-Type-Options', 'nosniff');

    const compressible = COMPRESSIBLE.has(ext) && entry.body.length >= GZIP_MIN;
    if (compressible) res.setHeader('Vary', 'Accept-Encoding');
    if (req.headers['if-none-match'] === entry.etag) {
      res.statusCode = 304;
      return res.end();
    }
    let body = entry.body;
    if (compressible && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
      // Compressed once per file version (async: the game loop keeps ticking).
      entry.gz ??= await gzipAsync(entry.body, { level: 9 });
      body = entry.gz;
      res.setHeader('Content-Encoding', 'gzip');
    }
    res.setHeader('Content-Length', body.length);
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  function notFound(res) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.end('Niet gevonden');
  }

  function health(res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      JSON.stringify({
        status: 'ok',
        version: APP_VERSION,
        protocol: PROTOCOL_VERSION,
        build: config.buildId,
        uptimeS: Math.round((Date.now() - startedAt) / 1000),
        ...getStats(),
      }),
    );
  }

  return async function handle(req, res) {
    try {
      res.setHeader('X-Robots-Tag', ROBOTS_TAG);
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.statusCode = 405;
        res.setHeader('Allow', 'GET, HEAD');
        return res.end();
      }
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/healthz') return health(res);
      if (url.pathname === WS_PATH) {
        res.statusCode = 426;
        return res.end('Upgrade Required');
      }
      await serveFile(req, res, url);
    } catch (err) {
      log.error('http error', { url: req.url, err: err.message });
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    }
  };
}

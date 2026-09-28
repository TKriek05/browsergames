// Validation of host-configurable game settings against the catalog schema.
// Used by the server (never trust the client) and by the lobby UI.
import { getGame } from './catalog.js';

export function defaultSettings(gameId) {
  const game = getGame(gameId);
  const out = {};
  if (!game) return out;
  for (const s of game.settings) out[s.key] = s.default;
  return out;
}

// Returns a clean settings object: known keys only, values checked against
// the schema. Invalid or missing values fall back to `prev`, then the default.
export function normalizeSettings(gameId, input, prev = defaultSettings(gameId)) {
  const game = getGame(gameId);
  const out = {};
  if (!game) return out;
  const src = input && typeof input === 'object' ? input : {};
  for (const s of game.settings) {
    const fallback = prev && Object.hasOwn(prev, s.key) ? prev[s.key] : s.default;
    const value = Object.hasOwn(src, s.key) ? src[s.key] : undefined;
    out[s.key] = isValid(s, value) ? value : fallback;
  }
  return out;
}

function isValid(setting, value) {
  if (value === undefined) return false;
  if (setting.type === 'select') return setting.options.some((o) => o.value === value);
  if (setting.type === 'toggle') return typeof value === 'boolean';
  return false;
}

export function settingLabel(gameId, key, value) {
  const s = getGame(gameId)?.settings.find((x) => x.key === key);
  if (!s) return String(value);
  if (s.type === 'toggle') return value ? 'Aan' : 'Uit';
  return s.options.find((o) => o.value === value)?.label ?? String(value);
}

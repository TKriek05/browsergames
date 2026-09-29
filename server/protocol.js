// Parsing and schema validation of everything a client sends.
// Treat all input as hostile: unknown types are ignored, known types are
// copied field-by-field into a fresh object so nothing unexpected leaks through.
import { PROTOCOL_VERSION, ROOM_CODE_PATTERN, BOT_LEVELS, MAX_PAYLOAD_BYTES } from '../shared/constants.js';
import { C2S, BIN, REACTIONS } from '../shared/messages.js';
import { ByteReader } from '../shared/binary.js';
import { PARTY_MODES, TOURNAMENT_ORDERS, TOURNAMENT_LENGTHS } from '../shared/party.js';

// --- Field validators: return the cleaned value or INVALID ------------------
const INVALID = Symbol('invalid');

const str = (max) => (v) => (typeof v === 'string' && v.length <= max ? v : INVALID);
const bool = () => (v) => (typeof v === 'boolean' ? v : INVALID);
const int = (min, max) => (v) => (Number.isInteger(v) && v >= min && v <= max ? v : INVALID);
const num = () => (v) => (typeof v === 'number' && Number.isFinite(v) ? v : INVALID);
const oneOf = (values) => (v) => (values.includes(v) ? v : INVALID);
const pattern = (re) => (v) => (typeof v === 'string' && re.test(v) ? v : INVALID);
const list = (check, max) => (v) => {
  if (!Array.isArray(v) || v.length > max) return INVALID;
  const out = v.map(check);
  return out.includes(INVALID) ? INVALID : out;
};
const optional = (check) => {
  const fn = (v) => (v === undefined ? undefined : check(v));
  fn.optional = true;
  return fn;
};
// Free-form game data (e.g. a board move). Size and shape are bounded here;
// the game module validates the meaning.
const data = () => (v) => (isPlainData(v, 0) ? v : INVALID);

function isPlainData(v, depth) {
  if (depth > 4) return false;
  if (v === null || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v.length <= 64;
  if (Array.isArray(v)) return v.length <= 128 && v.every((x) => isPlainData(x, depth + 1));
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    return keys.length <= 24 && keys.every((k) => k.length <= 32 && k !== '__proto__' && isPlainData(v[k], depth + 1));
  }
  return false;
}

const playerId = () => pattern(/^p\d{1,6}$/);
const token = () => pattern(/^[A-Za-z0-9_-]{24}$/);
const gameId = () => pattern(/^[a-z0-9]{2,16}$/);

// --- Schemas per message type ---------------------------------------------------
const SCHEMAS = {
  [C2S.HELLO]: { build: optional(str(64)) },
  [C2S.CREATE]: { game: optional(gameId()), name: str(200), solo: optional(bool()), mode: optional(oneOf(PARTY_MODES)) },
  [C2S.JOIN]: { code: pattern(ROOM_CODE_PATTERN), name: str(200), token: optional(token()) },
  [C2S.LEAVE]: {},
  [C2S.READY]: { ready: bool() },
  [C2S.NAME]: { name: str(200) },
  [C2S.COLOR]: {},
  [C2S.ROLE]: { role: oneOf(['player', 'spectator']) },
  [C2S.SETTINGS]: { settings: data() },
  [C2S.ADD_BOT]: { level: optional(oneOf(BOT_LEVELS)) },
  [C2S.REMOVE_BOT]: { id: playerId() },
  [C2S.BOT_LEVEL]: { id: playerId(), level: oneOf(BOT_LEVELS) },
  [C2S.FILL_BOTS]: { level: optional(oneOf(BOT_LEVELS)) },
  [C2S.KICK]: { id: playerId() },
  [C2S.GAME]: { game: gameId() },
  [C2S.PARTY]: {
    mode: optional(oneOf(PARTY_MODES)),
    order: optional(oneOf(TOURNAMENT_ORDERS)),
    length: optional(oneOf(TOURNAMENT_LENGTHS)),
    pool: optional(list(gameId(), 64)),
    restart: optional(bool()),
  },
  [C2S.DRAW]: {},
  [C2S.VOTE]: { game: optional(gameId()) },
  [C2S.START]: {},
  [C2S.TO_LOBBY]: {},
  [C2S.INPUT]: { data: data() },
  [C2S.REACT]: { r: int(0, REACTIONS.length - 1) },
  [C2S.PING]: { c: num() },
};

// Lobby actions share a stricter rate limit bucket.
export const LOBBY_TYPES = new Set([
  C2S.CREATE, C2S.JOIN, C2S.READY, C2S.NAME, C2S.COLOR, C2S.ROLE, C2S.SETTINGS,
  C2S.ADD_BOT, C2S.REMOVE_BOT, C2S.BOT_LEVEL, C2S.FILL_BOTS, C2S.KICK, C2S.START, C2S.TO_LOBBY,
  C2S.GAME, C2S.PARTY, C2S.DRAW, C2S.VOTE,
]);

// Result: { ok: true, msg } | { ok: false, reason, version? }
export function parseJson(raw) {
  if (raw.length > MAX_PAYLOAD_BYTES) return { ok: false, reason: 'too large' };
  let obj;
  try {
    obj = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
  } catch {
    return { ok: false, reason: 'bad json' };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, reason: 'not an object' };
  if (typeof obj.t !== 'string' || !Object.hasOwn(SCHEMAS, obj.t)) return { ok: false, reason: 'unknown type' };
  if (obj.v !== PROTOCOL_VERSION) return { ok: false, reason: 'version', version: obj.v };

  const schema = SCHEMAS[obj.t];
  const msg = { t: obj.t };
  for (const key of Object.keys(schema)) {
    const value = schema[key](obj[key]);
    if (value === INVALID) return { ok: false, reason: `bad field ${key}` };
    if (value !== undefined) msg[key] = value;
  }
  return { ok: true, msg };
}

// Binary frames: only realtime input is accepted from clients.
// Result: { ok: true, type, reader } with the header consumed.
export function parseBinary(buf) {
  if (buf.length < 2 || buf.length > 256) return { ok: false, reason: 'bad size' };
  const reader = new ByteReader(buf);
  const type = reader.u8();
  const version = reader.u8();
  if (version !== PROTOCOL_VERSION) return { ok: false, reason: 'version', version };
  if (type !== BIN.INPUT) return { ok: false, reason: 'unknown binary type' };
  return { ok: true, type, reader };
}

// Server -> client JSON encoder: every message carries type + version.
// They go last, so a payload field can never overwrite them.
export function encode(t, payload) {
  return JSON.stringify({ ...payload, t, v: PROTOCOL_VERSION });
}

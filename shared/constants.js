// Shared constants for client AND server.
// Pure data only: no DOM, no Node APIs. Tuning values live here so both sides agree.

export const APP_NAME = "Timon's Arcade";
export const APP_VERSION = '0.1.0';

// Bump whenever the wire format changes. A client with another version gets
// a friendly "please refresh" message instead of weird bugs.
export const PROTOCOL_VERSION = 8;

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------
export const MAX_PEOPLE_PER_ROOM = 6; // players + bots + spectators
export const ROOM_CODE_LENGTH = 4;
// No I, L, O (look like 1 and 0). Letters only, so codes are easy to read aloud.
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export const ROOM_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

export const RECONNECT_GRACE_MS = 60_000; // seat is kept this long after a disconnect
export const HOST_MIGRATE_DELAY_MS = 10_000; // disconnected host loses the crown after this
export const EMPTY_ROOM_TTL_MS = 2 * 60_000; // no connected humans
export const IDLE_ROOM_TTL_MS = 30 * 60_000; // no activity at all
export const ROOM_SWEEP_INTERVAL_MS = 1_000;

// ---------------------------------------------------------------------------
// Networking
// ---------------------------------------------------------------------------
export const WS_PATH = '/ws';
export const MAX_PAYLOAD_BYTES = 16 * 1024;
export const HELLO_TIMEOUT_MS = 10_000; // client must say hello within this time
export const HEARTBEAT_INTERVAL_MS = 25_000; // WS ping frames (Cloudflare drops idle sockets after ~100 s)
export const CLIENT_PING_INTERVAL_MS = 2_000; // app-level ping for the latency indicator + clock sync
export const RECONNECT_BACKOFF_MS = [300, 800, 1500, 2500, 4000, 5000];
export const RECONNECT_GIVE_UP_MS = 90_000;

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
export const SIM_TICK_RATE = 30; // server simulation for realtime games (Hz)
export const SNAPSHOT_RATE = 20; // snapshots to clients (Hz)
export const BOARD_TICK_RATE = 10; // turn-based games: timers + bots
export const INTERP_DELAY_MS = 100; // render other entities this far in the past
export const MAX_EXTRAPOLATE_MS = 120;
export const INPUT_QUEUE_SIZE = 12; // buffered inputs per player on the server
export const INPUT_CREDIT_MAX = 4; // max inputs a player may catch up in one tick
export const MAX_TICK_CATCHUP = 5; // server skips ahead instead of spiralling

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------
export const NAME_MAX_LENGTH = 16;

// Neon colours, readable on the dark background. Names are for screen readers.
export const PLAYER_COLORS = [
  { hex: '#ff4d6d', name: 'rood' },
  { hex: '#3ec5ff', name: 'blauw' },
  { hex: '#ffd23e', name: 'geel' },
  { hex: '#5dff8a', name: 'groen' },
  { hex: '#c77dff', name: 'paars' },
  { hex: '#ff9a3e', name: 'oranje' },
];

export const BOT_LEVELS = ['easy', 'normal', 'hard'];

// ---------------------------------------------------------------------------
// Per-game player limits. `max` is the number of seats; extra people (up to
// MAX_PEOPLE_PER_ROOM) become spectators. `min` counts humans + bots.
// ---------------------------------------------------------------------------
export const GAME_LIMITS = {
  tag: { min: 2, max: 6 },
  // Phase 1: board games
  tictactoe: { min: 2, max: 2 },
  connect4: { min: 2, max: 2 },
  checkers: { min: 2, max: 2 },
  reversi: { min: 2, max: 2 },
  chess: { min: 2, max: 2 },
  ludo: { min: 2, max: 4 },
  goose: { min: 2, max: 6 },
  battleship: { min: 2, max: 2 },
  // Phase 2-4
  duckshoot: { min: 1, max: 6 },
  tanks: { min: 2, max: 6 },
  kartrace: { min: 1, max: 6 },
  // Extras
  snake: { min: 2, max: 6 },
  paddle: { min: 2, max: 4 },
  breakout: { min: 1, max: 4 },
  bomber: { min: 2, max: 6 },
  ghosts: { min: 1, max: 4 },
  blocks: { min: 2, max: 6 },
  minigolf: { min: 1, max: 6 },
  memory: { min: 2, max: 6 },
  mines: { min: 1, max: 6 },
  invaders: { min: 1, max: 6 },
  rocks: { min: 1, max: 6 },
  // Party update
  paintball: { min: 2, max: 6 },
  pesten: { min: 2, max: 6 },
  quiz: { min: 1, max: 6 },
  penguins: { min: 2, max: 6 },
  artillery: { min: 2, max: 6 },
  fish: { min: 1, max: 6 },
  kladder: { min: 1, max: 6 },
  archery: { min: 1, max: 6 },
};

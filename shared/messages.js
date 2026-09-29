// Wire protocol vocabulary shared by client and server.
// JSON messages look like: { t: '<type>', v: PROTOCOL_VERSION, ...fields }
// Binary messages start with: [u8 BIN type][u8 PROTOCOL_VERSION] ...

// Client -> server (JSON)
export const C2S = Object.freeze({
  HELLO: 'hello',
  CREATE: 'create',
  JOIN: 'join',
  LEAVE: 'leave',
  READY: 'ready',
  NAME: 'name',
  COLOR: 'color',
  ROLE: 'role',
  SETTINGS: 'settings',
  ADD_BOT: 'addBot',
  REMOVE_BOT: 'removeBot',
  BOT_LEVEL: 'botLevel',
  FILL_BOTS: 'fillBots',
  KICK: 'kick',
  GAME: 'game', // host picks the next game: { game }
  PARTY: 'party', // host sets the party mode: { mode?, order?, length?, pool?, restart? }
  DRAW: 'draw', // host asks for another random game
  VOTE: 'vote', // anyone votes for the next game: { game? } (no game = take the vote back)
  START: 'start',
  TO_LOBBY: 'toLobby',
  INPUT: 'input', // turn-based moves etc: { data: {...} }
  REACT: 'react',
  PING: 'ping',
});

// Server -> client (JSON)
export const S2C = Object.freeze({
  WELCOME: 'welcome',
  JOINED: 'joined',
  ROOM: 'room',
  ERROR: 'error',
  START: 'start',
  SNAP: 'snap', // JSON snapshot (board games)
  EVENT: 'event', // one-off game events (sounds, effects)
  END: 'end',
  REACT: 'react',
  NOTICE: 'notice',
  PONG: 'pong',
});

// Binary message types (first byte)
export const BIN = Object.freeze({
  INPUT: 1, // client -> server realtime input
  SNAPSHOT: 2, // server -> client realtime snapshot
});

// Generic button bits for realtime input. Each game maps them to actions.
export const BTN = Object.freeze({
  A: 1 << 0, // primary: fire / accelerate / action
  B: 1 << 1, // secondary: brake / mine / drift
  X: 1 << 2, // item
  Y: 1 << 3,
  L: 1 << 4,
  R: 1 << 5,
  START: 1 << 6,
});

// WebSocket close codes (4000-4999 are free for applications)
export const CLOSE = Object.freeze({
  VERSION: 4000, // protocol mismatch: reload the page
  KICKED: 4001,
  REPLACED: 4002, // same seat opened in another tab
  POLICY: 4003, // too many invalid messages / rate limit abuse
  ROOM_CLOSED: 4004,
  HELLO_TIMEOUT: 4005,
  SERVER_RESTART: 1012,
});

// Error codes sent in { t: 'error', code }
export const ERR = Object.freeze({
  VERSION_MISMATCH: 'VERSION_MISMATCH',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  ROOM_CLOSED: 'ROOM_CLOSED',
  BAD_CODE: 'BAD_CODE',
  GAME_UNAVAILABLE: 'GAME_UNAVAILABLE',
  TOO_MANY_ROOMS: 'TOO_MANY_ROOMS',
  SERVER_FULL: 'SERVER_FULL',
  NOT_HOST: 'NOT_HOST',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  CANNOT_START: 'CANNOT_START',
  NO_SEAT: 'NO_SEAT',
  RATE_LIMITED: 'RATE_LIMITED',
  BAD_REQUEST: 'BAD_REQUEST',
  KICKED: 'KICKED',
});

// Dutch texts for error codes (shown in the UI).
export const ERROR_TEXT = Object.freeze({
  VERSION_MISMATCH: 'Er is een nieuwe versie van de arcade. Ververs de pagina.',
  ROOM_NOT_FOUND: 'Deze kamer bestaat niet (meer). Misschien is de code verkeerd of is de kamer al opgeruimd.',
  ROOM_FULL: 'Deze kamer zit vol (maximaal 6 personen).',
  ROOM_CLOSED: 'Deze kamer is gesloten.',
  BAD_CODE: 'Een kamercode bestaat uit 4 letters, bijvoorbeeld KXQF.',
  GAME_UNAVAILABLE: 'Dit spel is nog niet speelbaar.',
  TOO_MANY_ROOMS: 'Je hebt al te veel kamers open. Sluit er eerst een.',
  SERVER_FULL: 'De server is even vol. Probeer het zo nog eens.',
  NOT_HOST: 'Alleen de host kan dit doen.',
  NOT_IN_ROOM: 'Je zit niet in een kamer.',
  CANNOT_START: 'Het spel kan nog niet starten.',
  NO_SEAT: 'Er is geen vrije speelplek.',
  RATE_LIMITED: 'Rustig aan! Je stuurt te veel berichten.',
  BAD_REQUEST: 'Ongeldig verzoek.',
  KICKED: 'Je bent door de host uit de kamer verwijderd.',
});

// Quick reactions (index is sent over the wire, never free text).
export const REACTIONS = Object.freeze(['👍', '😂', '😮', '😡', '🎉', '👏', '🤔', '😭']);

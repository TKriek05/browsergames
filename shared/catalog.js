// Game catalog: display texts (Dutch) and host-configurable settings per game.
// Player limits come from constants.js so there is a single source of truth.
import { GAME_LIMITS } from './constants.js';

export const BOT_LEVEL_LABELS = { easy: 'Makkelijk', normal: 'Normaal', hard: 'Moeilijk' };

// Settings schema types:
//   select: { options: [{ value, label }], default }
//   toggle: { default: boolean }
const entries = [
  {
    id: 'tag',
    title: 'Neon Tikkertje',
    tagline: 'Tik elkaar af in een neon-arena. Wie het kortst de tikker is, wint.',
    kind: 'realtime',
    phase: 0,
    available: true,
    bots: true,
    controls: 'Pijltjes/WASD, gamepad of joystick',
    settings: [
      {
        key: 'duration',
        label: 'Speelduur',
        type: 'select',
        options: [
          { value: 60, label: '1 minuut' },
          { value: 90, label: '1,5 minuut' },
          { value: 120, label: '2 minuten' },
        ],
        default: 90,
      },
      {
        key: 'arena',
        label: 'Arena',
        type: 'select',
        options: [
          { value: 'pillars', label: 'Pilaren' },
          { value: 'maze', label: 'Doolhofje' },
          { value: 'open', label: 'Open veld' },
        ],
        default: 'pillars',
      },
    ],
  },

  // --- Phase 1: board games -------------------------------------------------
  {
    id: 'tictactoe', title: 'Boter-kaas-en-eieren', tagline: 'Drie op een rij, de snelste klassieker.',
    kind: 'board', phase: 1, available: true, bots: true, controls: 'Klik of tik op een vak, of pijltjes + Enter',
  },
  {
    id: 'connect4', title: 'Vier op een rij', tagline: 'Laat schijven vallen en maak er vier op een rij.',
    kind: 'board', phase: 1, available: true, bots: true, controls: 'Klik of tik op een kolom, of pijltjes + Enter',
  },
  {
    id: 'checkers', title: 'Dammen', tagline: 'Nederlandse regels op een 10×10 bord.',
    kind: 'board', phase: 1, available: true, bots: true,
    controls: 'Klik je stuk en daarna het doelveld (bij twijfel ook de tussenvelden)',
  },
  {
    id: 'reversi', title: 'Reversi', tagline: 'Sluit stenen in en draai ze om.',
    kind: 'board', phase: 1, available: true, bots: true, controls: 'Klik of tik op een vak met een stip, of pijltjes + Enter',
  },
  {
    id: 'chess', title: 'Schaken', tagline: 'Volledige regels, met bots in drie niveaus.',
    kind: 'board', phase: 1, available: true, bots: true, controls: 'Klik een stuk en daarna het doelveld, of pijltjes + Enter',
  },
  {
    id: 'ludo', title: 'Erger je niet!', tagline: 'Gooi, loop en sla elkaar terug naar start.',
    kind: 'board', phase: 1, available: true, bots: true, controls: 'Gooi met de knop of spatie, klik daarna een pion',
  },
  {
    id: 'goose', title: 'Ganzenbord', tagline: 'Het oer-Hollandse dobbelspel voor de hele groep.',
    kind: 'board', phase: 1, available: true, bots: true, controls: 'Gooi met de knop of spatie',
  },
  {
    id: 'battleship', title: 'Zeeslag', tagline: 'Verstop je vloot en jaag op die van de ander.',
    kind: 'board', phase: 1, available: true, bots: true, controls: 'Plaats je schepen, klik daarna op het water van de tegenstander',
    settings: [
      { key: 'touching', label: 'Schepen mogen elkaar raken', type: 'toggle', default: false },
      { key: 'extraShot', label: 'Nog een keer schieten bij raak', type: 'toggle', default: true },
    ],
  },

  // --- Phase 2-4 ----------------------------------------------------------------
  {
    id: 'duckshoot',
    title: 'Kwek Kwek Knal',
    tagline: 'Schiet eenden met z’n allen, samen of tegen elkaar.',
    kind: 'realtime',
    phase: 2,
    available: true,
    bots: true,
    controls: 'Muis of tik om te schieten, rechtsklik/R om te herladen. Toetsen: pijltjes + spatie',
    settings: [
      {
        key: 'mode',
        label: 'Spelvorm',
        type: 'select',
        options: [
          { value: 'versus', label: 'Tegen elkaar' },
          { value: 'coop', label: 'Samen (haal het quotum)' },
        ],
        default: 'versus',
      },
      {
        key: 'rounds',
        label: 'Rondes',
        type: 'select',
        options: [
          { value: 3, label: '3 rondes' },
          { value: 5, label: '5 rondes' },
          { value: 7, label: '7 rondes' },
        ],
        default: 5,
      },
    ],
  },
  {
    id: 'tanks',
    title: 'Tank Tumult',
    tagline: 'Tankgevechten in 3D met stuiterende kogels en kratten.',
    kind: 'realtime',
    phase: 3,
    available: true,
    bots: true,
    controls: 'Pijltjes/WASD rijden, muis mikken + klik of spatie schieten. Gamepad: rechter stick mikt',
    settings: [
      {
        key: 'mode',
        label: 'Spelvorm',
        type: 'select',
        options: [
          { value: 'deathmatch', label: 'Op tijd (meeste treffers)' },
          { value: 'rounds', label: 'Laatste tank (3 rondes winnen)' },
        ],
        default: 'deathmatch',
      },
      {
        key: 'duration',
        label: 'Speelduur (op tijd)',
        type: 'select',
        options: [
          { value: 120, label: '2 minuten' },
          { value: 180, label: '3 minuten' },
          { value: 300, label: '5 minuten' },
        ],
        default: 180,
      },
      {
        key: 'arena',
        label: 'Arena',
        type: 'select',
        options: [
          { value: 'kruispunt', label: 'Kruispunt' },
          { value: 'doolhof', label: 'Doolhof' },
          { value: 'fort', label: 'Fort' },
        ],
        default: 'kruispunt',
      },
    ],
  },
  { id: 'kartrace', title: 'Neon Kart GP', tagline: 'Retro kartracen met drift, items en een Grand Prix.', kind: 'realtime', phase: 4 },

  // --- Extras -------------------------------------------------------------------
  { id: 'snake', title: 'Slangenstrijd', tagline: 'Battle royale met slangen: blijf het langst over.', kind: 'realtime', phase: 5 },
  { id: 'paddle', title: 'Paddle Party', tagline: 'Batjes en een bal, met tot vier spelers.', kind: 'realtime', phase: 5 },
  { id: 'breakout', title: 'Stenenbreker', tagline: 'Samen de muur kapot kaatsen.', kind: 'realtime', phase: 5 },
  { id: 'bomber', title: 'Boemstad', tagline: 'Leg bommen, blaas muren op, blijf overeind.', kind: 'realtime', phase: 5 },
  { id: 'ghosts', title: 'Spookjesdoolhof', tagline: 'Eet stipjes en ontloop de spoken, samen.', kind: 'realtime', phase: 5 },
  { id: 'blocks', title: 'Blokval', tagline: 'Vallende blokken, versus met rommelrijen.', kind: 'realtime', phase: 5 },
  { id: 'minigolf', title: 'Minigolf', tagline: 'Top-down holes, om de beurt of tegelijk.', kind: 'realtime', phase: 5 },
  { id: 'memory', title: 'Onthoud ’m', tagline: 'Draai kaartjes om en vind de paren.', kind: 'board', phase: 5 },
  { id: 'mines', title: 'Mijnenveger', tagline: 'Samen het veld veilig vegen.', kind: 'board', phase: 5 },
  { id: 'invaders', title: 'Ruimtegolf', tagline: 'Houd de aanvallende golven samen tegen.', kind: 'realtime', phase: 5 },
  { id: 'rocks', title: 'Rotsregen', tagline: 'Schiet de ruimterotsen aan gruzelementen.', kind: 'realtime', phase: 5 },
];

// Fill in limits + defaults so consumers can rely on every field existing.
export const CATALOG = Object.freeze(
  Object.fromEntries(
    entries.map((e) => {
      const limits = GAME_LIMITS[e.id];
      if (!limits) throw new Error(`Missing GAME_LIMITS entry for ${e.id}`);
      return [
        e.id,
        Object.freeze({
          available: false,
          bots: false,
          spectators: true,
          controls: '',
          settings: [],
          ...e,
          min: limits.min,
          max: limits.max,
        }),
      ];
    }),
  ),
);

export const GAME_IDS = Object.keys(CATALOG);

export function getGame(id) {
  return Object.hasOwn(CATALOG, id) ? CATALOG[id] : null;
}
